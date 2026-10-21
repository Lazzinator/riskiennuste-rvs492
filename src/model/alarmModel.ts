// Hälytysmalli: tehtävätyypeittäin multiplikatiivinen Poisson-malli
//
//   odotettu hälytysmäärä päivässä = perustaso x kuukausi x viikonpäivä x sääkertoimet
//
// ja vuorokauden sisäinen jakauma tuntiprofiilina. Kertoimet estimoidaan historiasta
// suurimman uskottavuuden menetelmällä (iteratiivinen sovitus, IPF), ja jokaista kerrointa
// kutistetaan kohti arvoa 1, koska pienen palokunnan data on vähäistä. Kerroin 1,0 tarkoittaa
// keskimääräistä tilannetta.

import { TASK_TYPES, hourOf, type Incident, type TaskType } from '../data/schema';
import {
  FEATURES,
  MONTH_NAMES,
  TYPE_FEATURES,
  WEEKDAY_NAMES,
  type DayContext,
  type Feature,
  type FeatureKey,
} from './features';

export interface TypeModel {
  /** Odotettu hälytysmäärä päivässä, kun kaikki kertoimet ovat 1. */
  base: number;
  month: number[];
  weekday: number[];
  features: Partial<Record<FeatureKey, number[]>>;
  /** Tuntikertoimet, keskiarvo 1. */
  hour: number[];
  trainCount: number;
}

export type RiskLevel = 'matala' | 'kohonnut' | 'korkea';

export interface AlarmModel {
  trainStart: string;
  trainEnd: string;
  trainDays: number;
  /** Keskimääräinen hälytysmäärä päivässä opetusjaksolla. */
  meanDailyTotal: number;
  /**
   * Riskitason rajat suhteessa keskimääräiseen päivään. Asetetaan opetusjakson päivien
   * persentiileistä: noin 20 % päivistä on vähintään kohonnut ja 5 % korkea.
   */
  thresholds: { elevated: number; high: number };
  types: Record<TaskType, TypeModel>;
}

export interface FitOptions {
  /** Kutistuksen voimakkuus hälytysten määränä. Suurempi = varovaisempi malli. */
  priorMonth: number;
  priorWeekday: number;
  priorFeature: number;
  priorHour: number;
  iterations: number;
}

// Valittu ristiinvalidoimalla 30 erillisellä 5 vuoden simulaatiolla (ei oletussiemenellä).
// Viikonpäivien erot ovat pieniä suhteessa satunnaisvaihteluun, siksi vahva kutistus.
export const DEFAULT_FIT_OPTIONS: FitOptions = {
  priorMonth: 3,
  priorWeekday: 40,
  priorFeature: 2,
  priorHour: 15,
  iterations: 60,
};

export const THRESHOLD_QUANTILES = { elevated: 0.8, high: 0.95 };

interface FactorGroup {
  key: string;
  nLevels: number;
  levelOf(c: DayContext): number;
  prior: number;
  /** Kuukausien kertoimet tasoitetaan naapurikuukausien kanssa. */
  circular: boolean;
  monotone?: 'increasing' | 'decreasing';
}

/**
 * Tyyppikohtainen kuukausikutistus. Rakennuspalojen talvihuippu johtuu pääosin lämmityksestä,
 * ja kuukausi ja lämpötila kulkevat lähes yhdessä. Vahva kutistus antaa lämpötilan selittää
 * kausivaihtelun, jolloin malli reagoi myös poikkeuksellisen kylmään syksyyn tai lämpimään talveen.
 */
export const TYPE_MONTH_PRIOR: Partial<Record<TaskType, number>> = { rakennuspalo: 30 };

function groupsFor(type: TaskType, opt: FitOptions): FactorGroup[] {
  return [
    { key: 'month', nLevels: 12, levelOf: (c) => c.month, prior: TYPE_MONTH_PRIOR[type] ?? opt.priorMonth, circular: true },
    { key: 'weekday', nLevels: 7, levelOf: (c) => c.weekday, prior: opt.priorWeekday, circular: false },
    ...TYPE_FEATURES[type].map((k) => ({
      key: k,
      nLevels: FEATURES[k].levels.length,
      levelOf: FEATURES[k].levelOf,
      prior: opt.priorFeature,
      circular: false,
      monotone: (FEATURES[k] as Feature).monotone,
    })),
  ];
}

/**
 * Painotettu isotoninen regressio (pool adjacent violators): lähin kasvava jono.
 * Rikkovat naapuriluokat yhdistetään painotetuksi keskiarvoksi.
 */
export function isotonicIncreasing(values: readonly number[], weights: readonly number[]): number[] {
  const blocks: Array<{ value: number; weight: number; count: number }> = [];
  values.forEach((v, i) => {
    blocks.push({ value: v, weight: Math.max(weights[i]!, 1e-9), count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.value > blocks[blocks.length - 1]!.value) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      const weight = a.weight + b.weight;
      blocks.push({ value: (a.value * a.weight + b.value * b.weight) / weight, weight, count: a.count + b.count });
    }
  });
  return blocks.flatMap((b) => new Array<number>(b.count).fill(b.value));
}

const smoothCircular = (xs: readonly number[]): number[] =>
  xs.map((x, i) => 0.25 * xs[(i + xs.length - 1) % xs.length]! + 0.5 * x + 0.25 * xs[(i + 1) % xs.length]!);

/** Päiväkohtaiset hälytysmäärät tyypeittäin. Päivät, joita ei löydy, ohitetaan. */
export function dailyCounts(days: readonly DayContext[], incidents: readonly Incident[]): Record<TaskType, number[]> {
  const index = new Map(days.map((d, i) => [d.date, i]));
  const out = Object.fromEntries(TASK_TYPES.map((t) => [t, new Array<number>(days.length).fill(0)])) as Record<
    TaskType,
    number[]
  >;
  for (const inc of incidents) {
    const i = index.get(inc.time.slice(0, 10));
    if (i !== undefined) out[inc.taskType][i]!++;
  }
  return out;
}

function fitDaily(
  days: readonly DayContext[],
  y: readonly number[],
  groups: readonly FactorGroup[],
  iterations: number,
): { base: number; factors: number[][] } {
  const n = days.length;
  const idx = groups.map((g) => days.map((d) => g.levelOf(d)));
  const factors = groups.map((g) => new Array<number>(g.nLevels).fill(1));
  const total = y.reduce((s, v) => s + v, 0);
  let base = total / n;
  const lambda = new Float64Array(n);

  const recompute = (): void => {
    for (let i = 0; i < n; i++) {
      let l = base;
      for (let g = 0; g < groups.length; g++) l *= factors[g]![idx[g]![i]!]!;
      lambda[i] = l;
    }
  };

  for (let it = 0; it < iterations; it++) {
    for (let g = 0; g < groups.length; g++) {
      recompute();
      const group = groups[g]!;
      const f = factors[g]!;
      let obs = new Array<number>(group.nLevels).fill(0);
      let exp = new Array<number>(group.nLevels).fill(0);
      for (let i = 0; i < n; i++) {
        const l = idx[g]![i]!;
        obs[l]! += y[i]!;
        exp[l]! += lambda[i]! / f[l]!;
      }
      if (group.circular) {
        obs = smoothCircular(obs);
        exp = smoothCircular(exp);
      }
      for (let l = 0; l < group.nLevels; l++) {
        f[l] = exp[l]! > 0 ? (obs[l]! + group.prior) / (exp[l]! + group.prior) : 1;
      }
      if (group.monotone) {
        const w = exp.map((e) => e + group.prior);
        const fitted =
          group.monotone === 'increasing'
            ? isotonicIncreasing(f, w)
            : isotonicIncreasing([...f].reverse(), [...w].reverse()).reverse();
        fitted.forEach((v, l) => (f[l] = v));
      }
      // Normalisoidaan niin, että keskimääräisen päivän kerroin on 1, ja siirretään taso perustasoon.
      let mean = 0;
      for (let i = 0; i < n; i++) mean += f[idx[g]![i]!]!;
      mean /= n;
      for (let l = 0; l < group.nLevels; l++) f[l]! /= mean;
      base *= mean;
    }
    recompute();
    const sumLambda = lambda.reduce((s, v) => s + v, 0);
    if (sumLambda > 0) base *= total / sumLambda;
  }
  return { base, factors };
}

function hourShares(counts: readonly number[], prior: readonly number[], priorWeight: number): number[] {
  const smoothed = smoothCircular(counts);
  const n = smoothed.reduce((s, v) => s + v, 0);
  return smoothed.map((c, h) => (c + priorWeight * prior[h]!) / (n + priorWeight));
}

export function fitAlarmModel(
  days: readonly DayContext[],
  incidents: readonly Incident[],
  options: Partial<FitOptions> = {},
): AlarmModel {
  const opt = { ...DEFAULT_FIT_OPTIONS, ...options };
  if (days.length === 0) throw new Error('opetusjakso on tyhjä');
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  const inRange = incidents.filter((i) => i.time.slice(0, 10) >= first && i.time.slice(0, 10) <= last);
  const counts = dailyCounts(days, inRange);

  // Yhteinen tuntiprofiili kaikista hälytyksistä toimii tyyppikohtaisen profiilin lähtökohtana.
  const allHours = new Array<number>(24).fill(0);
  for (const inc of inRange) allHours[hourOf(inc.time)]!++;
  const pooled = hourShares(allHours, new Array<number>(24).fill(1 / 24), 24);

  const types = {} as Record<TaskType, TypeModel>;
  for (const type of TASK_TYPES) {
    const groups = groupsFor(type, opt);
    const { base, factors } = fitDaily(days, counts[type], groups, opt.iterations);
    const hours = new Array<number>(24).fill(0);
    for (const inc of inRange) if (inc.taskType === type) hours[hourOf(inc.time)]!++;
    const features: Partial<Record<FeatureKey, number[]>> = {};
    TYPE_FEATURES[type].forEach((k, j) => (features[k] = factors[2 + j]!));
    types[type] = {
      base,
      month: factors[0]!,
      weekday: factors[1]!,
      features,
      hour: hourShares(hours, pooled, opt.priorHour).map((s) => s * 24),
      trainCount: counts[type].reduce((s, v) => s + v, 0),
    };
  }

  const model: AlarmModel = {
    trainStart: first,
    trainEnd: last,
    trainDays: days.length,
    meanDailyTotal: inRange.length / days.length,
    thresholds: { elevated: 1, high: 1 },
    types,
  };
  const ratios = days
    .map((d) => TASK_TYPES.reduce((s, t) => s + expectedByType(model, d)[t], 0) / model.meanDailyTotal)
    .sort((a, b) => a - b);
  const quantile = (q: number): number => ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))]!;
  model.thresholds = { elevated: quantile(THRESHOLD_QUANTILES.elevated), high: quantile(THRESHOLD_QUANTILES.high) };
  return model;
}

// ---------------------------------------------------------------------------
// Ennuste ja selitykset
// ---------------------------------------------------------------------------

export interface ReasonPart {
  taskType: TaskType;
  /** Kerroin suhteessa tavalliseen tilanteeseen */
  multiplier: number;
  /** Odotettu lisäys (tai vähennys) hälytysmäärään */
  extra: number;
}

export interface Reason {
  key: string;
  /** Esim. "liukas keli", "perjantai", "huhtikuu" */
  label: string;
  /** Odotettu lisäys koko hälytysmäärään. Negatiivinen = vähentää riskiä. */
  extra: number;
  /** Kerroin koko päivän hälytysmäärään */
  multiplier: number;
  parts: ReasonPart[];
}

export interface DayPrediction {
  date: string;
  total: number;
  byType: Record<TaskType, number>;
  /** Suhde keskimääräiseen päivään */
  ratio: number;
  level: RiskLevel;
  /** Riskiä nostavat syyt suurimmasta pienimpään */
  reasons: Reason[];
  /** Riskiä laskevat syyt */
  dampeners: Reason[];
}

export function expectedByType(model: AlarmModel, ctx: DayContext): Record<TaskType, number> {
  const out = {} as Record<TaskType, number>;
  for (const type of TASK_TYPES) {
    const m = model.types[type];
    let l = m.base * m.month[ctx.month]! * m.weekday[ctx.weekday]!;
    for (const k of TYPE_FEATURES[type]) l *= m.features[k]![FEATURES[k].levelOf(ctx)]!;
    out[type] = l;
  }
  return out;
}

export function riskLevel(model: AlarmModel, ratio: number): RiskLevel {
  if (ratio >= model.thresholds.high) return 'korkea';
  if (ratio >= model.thresholds.elevated) return 'kohonnut';
  return 'matala';
}

/** Tehtävätyypin kerroin otetaan syyn osaksi vain, jos se poikkeaa ykkösestä vähintään näin paljon. */
const MIN_PART_EFFECT = 0.1;
/** Syy näytetään vain, jos se muuttaa koko päivän hälytysmäärää vähintään näin paljon. */
const MIN_TOTAL_EFFECT = 0.03;
/**
 * Tehtävätyypin osuus syystä näytetään vain, jos sen vaikutus on vähintään tämä osuus päivän
 * odotetusta määrästä. Muuten esim. lumipeitteen aikana näkyisi "maastopaloja 2-kertaisesti",
 * vaikka maastopaloriski on käytännössä nolla.
 */
const MIN_PART_SHARE = 0.01;

export function predictDay(model: AlarmModel, ctx: DayContext): DayPrediction {
  const byType = expectedByType(model, ctx);
  const total = TASK_TYPES.reduce((s, t) => s + byType[t], 0);
  const ratio = total / model.meanDailyTotal;

  // Kerätään jokaisen kertoimen vaikutus tyypeittäin ja yhdistetään saman nimiset syyt.
  const grouped = new Map<string, { label: string; parts: ReasonPart[] }>();
  const add = (key: string, label: string, taskType: TaskType, multiplier: number): void => {
    if (!grouped.has(key)) grouped.set(key, { label, parts: [] });
    grouped.get(key)!.parts.push({ taskType, multiplier, extra: byType[taskType] * (1 - 1 / multiplier) });
  };
  for (const type of TASK_TYPES) {
    const m = model.types[type];
    add(`month:${ctx.month}`, MONTH_NAMES[ctx.month]!, type, m.month[ctx.month]!);
    add(`weekday:${ctx.weekday}`, WEEKDAY_NAMES[ctx.weekday]!, type, m.weekday[ctx.weekday]!);
    for (const k of TYPE_FEATURES[type]) {
      const f = FEATURES[k];
      const level = f.levelOf(ctx);
      if (level === f.neutralLevel) continue;
      // Sääkerroin verrataan tavalliseen säähän, ei koko aineiston keskiarvoon.
      const factors = m.features[k]!;
      add(`${k}:${level}`, f.levels[level]!, type, factors[level]! / factors[f.neutralLevel]!);
    }
  }

  const all: Reason[] = [...grouped].map(([key, g]) => {
    const extra = g.parts.reduce((s, p) => s + p.extra, 0);
    return {
      key,
      label: g.label,
      extra,
      multiplier: total / (total - extra),
      parts: g.parts.filter(
        (p) => Math.abs(p.multiplier - 1) >= MIN_PART_EFFECT && Math.abs(p.extra) >= MIN_PART_SHARE * total,
      ),
    };
  });
  // Osat järjestetään vaikutuksen mukaan syyn suuntaan: nostavissa suurin lisäys ensin.
  const reasons = all
    .filter((r) => r.multiplier >= 1 + MIN_TOTAL_EFFECT && r.parts.length > 0)
    .map((r) => ({ ...r, parts: r.parts.filter((p) => p.extra > 0).sort((a, b) => b.extra - a.extra) }))
    .sort((a, b) => b.extra - a.extra);
  const dampeners = all
    .filter((r) => r.multiplier <= 1 - MIN_TOTAL_EFFECT && r.parts.length > 0)
    .map((r) => ({ ...r, parts: r.parts.filter((p) => p.extra < 0).sort((a, b) => a.extra - b.extra) }))
    .sort((a, b) => a.extra - b.extra);

  return { date: ctx.date, total, byType, ratio, level: riskLevel(model, ratio), reasons, dampeners };
}

/** Odotettu hälytysmäärä tunneittain (24 arvoa). */
export function hourlyExpected(model: AlarmModel, prediction: DayPrediction): number[] {
  const out = new Array<number>(24).fill(0);
  for (const type of TASK_TYPES) {
    const hour = model.types[type].hour;
    for (let h = 0; h < 24; h++) out[h]! += (prediction.byType[type] * hour[h]!) / 24;
  }
  return out;
}

/** Vuorokauden kuormittunein yhtenäinen aikaikkuna, esim. klo 15-19. */
export function peakWindow(hourly: readonly number[], length = 4): { startHour: number; endHour: number; share: number } {
  const total = hourly.reduce((s, v) => s + v, 0);
  let best = 0;
  let bestStart = 0;
  for (let s = 0; s + length <= 24; s++) {
    let sum = 0;
    for (let h = s; h < s + length; h++) sum += hourly[h]!;
    if (sum > best) {
      best = sum;
      bestStart = s;
    }
  }
  return { startHour: bestStart, endHour: bestStart + length, share: total > 0 ? best / total : 0 };
}

export interface RangePrediction {
  days: DayPrediction[];
  total: number;
  ratio: number;
  level: RiskLevel;
  /** Todennäköisyys, että jaksolla tulee vähintään yksi hälytys (Poisson). */
  probAtLeastOne: number;
}

export function predictRange(model: AlarmModel, contexts: readonly DayContext[]): RangePrediction {
  const days = contexts.map((c) => predictDay(model, c));
  const total = days.reduce((s, d) => s + d.total, 0);
  const ratio = total / (model.meanDailyTotal * Math.max(1, days.length));
  return { days, total, ratio, level: riskLevel(model, ratio), probAtLeastOne: 1 - Math.exp(-total) };
}
