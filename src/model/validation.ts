// Mallin validointi: opetus kaikilla paitsi viimeisellä vuodella, testaus viimeisellä vuodella.
// Vertailukohta on "pelkkä keskiarvo": jokaiselle tehtävätyypille sama odotusarvo joka päivä.

import { TASK_TYPES, type Dataset, type Grid, type Incident, type TaskType } from '../data/schema';
import { fitAlarmModel, dailyCounts, expectedByType, predictDay, type AlarmModel, type RiskLevel } from './alarmModel';
import { buildDayContexts, TYPE_FEATURES, type DayContext } from './features';
import { fitSpatialModel } from './spatialModel';
import { wildfireRisk, type WildfireLevel } from './wildfire';

export interface ScorePair {
  model: number;
  baseline: number;
}

export interface ValidationReport {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainIncidents: number;
  testIncidents: number;
  /** Poisson-devianssi päivää kohden, tyypeittäin laskettuna ja summattuna. Pienempi on parempi. */
  dailyDeviance: ScorePair;
  /** Log-uskottavuuden parannus päivää kohden verrattuna keskiarvoon. Positiivinen = malli parempi. */
  logLikGainPerDay: number;
  /** Kuukausittaisten hälytysmäärien keskimääräinen absoluuttinen virhe. */
  monthlyMae: ScorePair;
  monthly: { actual: number[]; model: number[]; baseline: number[] };
  byType: Array<{
    taskType: TaskType;
    actual: number;
    model: number;
    baseline: number;
    /** Log-uskottavuuden parannus koko testivuodelta */
    logLikGain: number;
  }>;
  /** Testivuoden päivät ennustetun riskitason mukaan: toteutuuko korkeampi taso todella? */
  riskLevels: Array<{ level: RiskLevel; days: number; expectedPerDay: number; actualPerDay: number }>;
  /** Riskikartta: testihälytysten keskimääräinen log-pistemäärä verrattuna tasajakaumaan. */
  spatialLogScoreVsUniform: number | null;
  /** Onko malli opetettu sääselittäjien kanssa. */
  usesWeather: boolean;
  /** Sääselittäjien valinta tehtävätyypeittäin (vain kun sää on käytössä). */
  weatherSelection: WeatherSelection | null;
  /**
   * Maastopaloindeksi koko aineistossa (indeksiä ei sovitettu datan perusteella).
   * Tyhjä, jos oikeaa säädataa ei ole.
   */
  wildfire: Array<{ level: WildfireLevel; days: number; fires: number; firesPer100Days: number }>;
}

function logFactorial(k: number): number {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
}

const poissonLogLik = (y: number, lambda: number): number =>
  y * Math.log(Math.max(lambda, 1e-12)) - lambda - logFactorial(y);

const poissonDeviance = (y: number, lambda: number): number =>
  2 * ((y > 0 ? y * Math.log(y / Math.max(lambda, 1e-12)) : 0) - (y - lambda));

export interface WeatherSelection {
  /** Log-uskottavuus vuosittaisessa ristiinvalidoinnissa: keskiarvo, malli ilman säätä, malli säällä */
  byType: Record<TaskType, { mean: number; noWeather: number; withWeather: number }>;
  /** Tyypit, joilla sää paransi ennustetta */
  weatherTypes: TaskType[];
  folds: number;
}

/**
 * Vähimmäisparannus (log-uskottavuus, kaikki testivuodet yhteensä), jotta sää otetaan mukaan.
 * Oikeassa datassa rakennuspalojen parannus oli 0,2: sattuman tasoa, eikä sen perusteella
 * kannata näyttää jäsenille "lämmitystarve"-syitä. Yksi yksikkö vastaa karkeasti yhden
 * lisäparametrin hintaa.
 */
export const MIN_WEATHER_GAIN = 1;

/**
 * Valitsee tehtävätyypit, joille sää otetaan mukaan: kukin vuosi vuorollaan testijoukkona,
 * ja sää valitaan, jos se parantaa testivuosien yhteenlaskettua log-uskottavuutta vähintään
 * MIN_WEATHER_GAIN verrattuna samaan malliin ilman säätä. Näin sää ei heikennä ennustetta tyypeillä, joihin sillä ei ole
 * datassa vaikutusta.
 */
export function selectWeatherTypes(days: readonly DayContext[], incidents: readonly Incident[]): WeatherSelection {
  const years = [...new Set(days.map((d) => d.date.slice(0, 4)))];
  const byType = Object.fromEntries(TASK_TYPES.map((t) => [t, { mean: 0, noWeather: 0, withWeather: 0 }])) as WeatherSelection['byType'];
  let folds = 0;
  for (const y of years) {
    const train = days.filter((d) => !d.date.startsWith(y));
    const test = days.filter((d) => d.date.startsWith(y));
    if (train.length < 365 || test.length < 90) continue;
    folds++;
    const trainInc = incidents.filter((i) => !i.time.startsWith(y));
    const m0 = fitAlarmModel(train, trainInc, { useWeather: false, iterations: 30 });
    const m1 = fitAlarmModel(train, trainInc, { useWeather: true, iterations: 30 });
    const counts = dailyCounts(test, incidents.filter((i) => i.time.startsWith(y)));
    test.forEach((c, i) => {
      const e0 = expectedByType(m0, c);
      const e1 = expectedByType(m1, c);
      for (const t of TASK_TYPES) {
        const n = counts[t][i]!;
        byType[t].mean += poissonLogLik(n, m0.types[t].trainCount / train.length);
        byType[t].noWeather += poissonLogLik(n, e0[t]);
        byType[t].withWeather += poissonLogLik(n, e1[t]);
      }
    });
  }
  const weatherTypes = TASK_TYPES.filter(
    (t) => TYPE_FEATURES[t].length > 0 && byType[t].withWeather - byType[t].noWeather >= MIN_WEATHER_GAIN,
  );
  return { byType, weatherTypes, folds };
}

/** Testijakson ensimmäinen päivä: viimeiset 365 päivää päättyen annettuun päivään. */
export function testStartFor(lastDate: string): string {
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 364);
  return d.toISOString().slice(0, 10);
}

/** Viimeiset 365 päivää testijoukoksi, aiemmat opetukseen. */
export function splitLastYear(days: readonly DayContext[]): { train: DayContext[]; test: DayContext[]; testStart: string } {
  const testStart = testStartFor(days[days.length - 1]!.date);
  return {
    train: days.filter((d) => d.date < testStart),
    test: days.filter((d) => d.date >= testStart),
    testStart,
  };
}

/**
 * Riskikartan validointi: opetus ennen testijakson alkua, testihälytysten keskimääräinen
 * log-pistemäärä tasajakaumaan verrattuna. null, jos hälytyksillä ei ole sijaintia.
 */
export function spatialValidation(grid: Grid, incidents: readonly Incident[], testStart: string): number | null {
  const located = incidents.filter((i) => i.cellId !== null);
  const train = located.filter((i) => i.time.slice(0, 10) < testStart);
  const test = located.filter((i) => i.time.slice(0, 10) >= testStart);
  if (train.length === 0 || test.length === 0) return null;
  const spatial = fitSpatialModel(grid, train);
  const cellIndex = new Map(spatial.cellIds.map((id, i) => [id, i]));
  const nCells = spatial.cellIds.length;
  let score = 0;
  let n = 0;
  for (const inc of test) {
    const j = cellIndex.get(inc.cellId!);
    if (j === undefined) continue;
    score += Math.log(spatial.shares[inc.taskType][j]! * nCells);
    n++;
  }
  return n ? score / n : null;
}

export function validateModel(ds: Dataset, options: { useWeather?: boolean } = {}): ValidationReport {
  const useWeather = options.useWeather ?? true;
  // Vain hälytysaineiston jakso; säätä voi olla myös sen jälkeen (nykysää ja ennuste).
  const days = buildDayContexts(ds.weather).filter((d) => d.date >= ds.meta.startDate && d.date <= ds.meta.endDate);
  const { train, test, testStart } = splitLastYear(days);
  if (train.length < 365 || test.length === 0) throw new Error('validointi vaatii vähintään kaksi vuotta dataa');
  const testEnd = test[test.length - 1]!.date;
  const trainInc = ds.incidents.filter((i) => i.time.slice(0, 10) < testStart);
  const testInc = ds.incidents.filter((i) => i.time.slice(0, 10) >= testStart && i.time.slice(0, 10) <= testEnd);

  // Sään valinta tehdään vain opetusjaksolla, jottei testijakso vaikuta malliin.
  const weatherSelection = useWeather ? selectWeatherTypes(train, trainInc) : null;
  const model: AlarmModel = fitAlarmModel(train, trainInc, { useWeather, weatherTypes: weatherSelection?.weatherTypes });
  const baselineRate = Object.fromEntries(
    TASK_TYPES.map((t) => [t, model.types[t].trainCount / train.length]),
  ) as Record<TaskType, number>;

  const counts = dailyCounts(test, testInc);
  const predictions = test.map((c) => expectedByType(model, c));

  let devModel = 0;
  let devBase = 0;
  let llGain = 0;
  const byType = TASK_TYPES.map((t) => {
    let actual = 0;
    let predicted = 0;
    let gain = 0;
    test.forEach((_, i) => {
      const y = counts[t][i]!;
      const lm = predictions[i]![t];
      const lb = baselineRate[t];
      actual += y;
      predicted += lm;
      devModel += poissonDeviance(y, lm);
      devBase += poissonDeviance(y, lb);
      gain += poissonLogLik(y, lm) - poissonLogLik(y, lb);
    });
    llGain += gain;
    return { taskType: t, actual, model: predicted, baseline: baselineRate[t] * test.length, logLikGain: gain };
  });

  const monthly = { actual: new Array<number>(12).fill(0), model: new Array<number>(12).fill(0), baseline: new Array<number>(12).fill(0) };
  const baseTotal = TASK_TYPES.reduce((s, t) => s + baselineRate[t], 0);
  test.forEach((c, i) => {
    monthly.actual[c.month]! += TASK_TYPES.reduce((s, t) => s + counts[t][i]!, 0);
    monthly.model[c.month]! += TASK_TYPES.reduce((s, t) => s + predictions[i]![t], 0);
    monthly.baseline[c.month]! += baseTotal;
  });
  const mae = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + Math.abs(x - b[i]!), 0) / a.length;

  const levels: RiskLevel[] = ['matala', 'kohonnut', 'korkea'];
  const levelStats = new Map(levels.map((l) => [l, { days: 0, expected: 0, actual: 0 }]));
  test.forEach((c, i) => {
    const p = predictDay(model, c);
    const s = levelStats.get(p.level)!;
    s.days++;
    s.expected += p.total;
    s.actual += TASK_TYPES.reduce((sum, t) => sum + counts[t][i]!, 0);
  });


  const fireDays = dailyCounts(days, ds.incidents).maastopalo;
  const wf = new Map<WildfireLevel, { days: number; fires: number }>();
  for (const l of [1, 2, 3, 4, 5] as WildfireLevel[]) wf.set(l, { days: 0, fires: 0 });
  days.forEach((c, i) => {
    const s = wf.get(wildfireRisk(c).level)!;
    s.days++;
    s.fires += fireDays[i]!;
  });

  return {
    trainStart: train[0]!.date,
    trainEnd: train[train.length - 1]!.date,
    testStart: test[0]!.date,
    testEnd: test[test.length - 1]!.date,
    trainIncidents: trainInc.length,
    testIncidents: testInc.length,
    dailyDeviance: { model: devModel / test.length, baseline: devBase / test.length },
    logLikGainPerDay: llGain / test.length,
    monthlyMae: { model: mae(monthly.model, monthly.actual), baseline: mae(monthly.baseline, monthly.actual) },
    monthly,
    byType,
    riskLevels: levels.map((l) => {
      const s = levelStats.get(l)!;
      return {
        level: l,
        days: s.days,
        expectedPerDay: s.days ? s.expected / s.days : 0,
        actualPerDay: s.days ? s.actual / s.days : 0,
      };
    }),
    spatialLogScoreVsUniform: spatialValidation(ds.grid, ds.incidents, testStart),
    usesWeather: useWeather,
    weatherSelection,
    // Indeksi lasketaan säästä, joten vertailu oikeisiin paloihin vaatii oikean säädatan.
    wildfire: useWeather
      ? [...wf].map(([level, s]) => ({
          level,
          days: s.days,
          fires: s.fires,
          firesPer100Days: s.days ? (100 * s.fires) / s.days : 0,
        }))
      : [],
  };
}
