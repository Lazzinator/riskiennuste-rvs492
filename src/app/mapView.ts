// Riskikartan sisältö puhtaana funktiona: ruutukohtaiset odotusarvot, riskiluokat ja kuvaukset.
// Ruudun riski = "missä" (historiallinen tiheys) x "milloin ja millä säällä" (hälytysmalli).
// Historiallisia hälytysmääriä ruuduittain ei näytetä, jotta yksittäisiä kohteita ei voi päätellä.

import { describeCell } from '../data/geo';
import { TASK_TYPES, TASK_TYPE_LABELS, type Grid, type TaskType, type WeatherDay } from '../data/schema';
import { expectedByType, type AlarmModel } from '../model/alarmModel';
import { buildDayContexts } from '../model/features';
import { cellExpected, type SpatialModel } from '../model/spatialModel';
import { resolveDate } from './todayView';

export type MapPeriod = 'tanaan' | 'huomenna' | 'viikko' | 'vuosi';
export type MapTaskFilter = TaskType | 'kaikki';

export const MAP_PERIODS: ReadonlyArray<{ id: MapPeriod; label: string }> = [
  { id: 'tanaan', label: 'Tänään' },
  { id: 'huomenna', label: 'Huomenna' },
  { id: 'viikko', label: 'Seuraavat 7 päivää' },
  { id: 'vuosi', label: 'Keskimääräinen vuosi' },
];

/** Riskiluokat suhteessa alueen keskimääräiseen ruutuun. Kiinteät rajat, jotta luokka tarkoittaa aina samaa. */
export const RISK_CLASSES = [
  { max: 0.5, label: 'alle puolet keskiarvosta' },
  { max: 1, label: '0,5-1 x keskiarvo' },
  { max: 2, label: '1-2 x keskiarvo' },
  { max: 4, label: '2-4 x keskiarvo' },
  { max: Infinity, label: 'yli 4 x keskiarvo' },
] as const;

/**
 * Riskiluokkien värit: yksi punainen sävy tummasta (pieni riski) kirkkaaseen (suuri riski).
 * Tarkistettu järjestysasteikkona tummaa pintaa #111418 vasten (yksi sävy, kasvava vaaleus,
 * erottuvat askeleet, pienin askel vähintään 2:1 kontrastissa).
 */
export const RISK_COLORS = ['#843330', '#ab3d33', '#cf4c3c', '#ec6c53', '#ffa08a'] as const;

export interface MapCell {
  id: string;
  south: number;
  west: number;
  north: number;
  east: number;
  /** Odotettu hälytysmäärä ruudussa valitulla jaksolla */
  expected: number;
  /** Suhde alueen keskimääräiseen ruutuun */
  ratio: number;
  /** 0-4, ks. RISK_CLASSES */
  riskClass: number;
  description: string;
  /** Ruudun todennäköisimmät tehtävätyypit (kun suodatin on "kaikki") */
  topTypes: Array<{ label: string; share: number }>;
}

export interface MapView {
  periodLabel: string;
  /** Ensimmäinen ja viimeinen päivä, tai null keskimääräiselle vuodelle */
  dates: { first: string; last: string } | null;
  taskLabel: string;
  /** Koko alueen odotettu hälytysmäärä valitulla jaksolla ja tyypillä */
  total: number;
  cells: MapCell[];
  /** Riskialttiimmat ruudut kuvauksineen (eri kuvaukset, suurin ensin) */
  hotspots: MapCell[];
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Tehtävätyypeittäinen odotusarvo valitulle jaksolle. */
export function periodExpectation(
  alarm: AlarmModel,
  weather: readonly WeatherDay[],
  period: MapPeriod,
  today: string,
): { byType: Record<TaskType, number>; dates: { first: string; last: string } | null } {
  const byType = Object.fromEntries(TASK_TYPES.map((t) => [t, 0])) as Record<TaskType, number>;
  if (period === 'vuosi') {
    const years = alarm.trainDays / 365.25;
    for (const t of TASK_TYPES) byType[t] = alarm.types[t].trainCount / years;
    return { byType, dates: null };
  }
  const contexts = buildDayContexts(weather);
  const available = new Set(weather.map((w) => w.date));
  const start = resolveDate(available, today, weather[0]!.date, weather[weather.length - 1]!.date);
  const offset = period === 'huomenna' ? 1 : 0;
  const length = period === 'viikko' ? 7 : 1;
  const i0 = contexts.findIndex((c) => c.date === start) + offset;
  const chosen = contexts.slice(i0, i0 + length);
  for (const c of chosen) {
    const e = expectedByType(alarm, c);
    for (const t of TASK_TYPES) byType[t] += e[t];
  }
  const first = chosen[0]?.date ?? addDays(start, offset);
  return { byType, dates: { first, last: chosen[chosen.length - 1]?.date ?? first } };
}

export function riskClassOf(ratio: number): number {
  return RISK_CLASSES.findIndex((c) => ratio < c.max);
}

export function buildMapView(
  alarm: AlarmModel,
  spatial: SpatialModel,
  grid: Grid,
  weather: readonly WeatherDay[],
  options: { period: MapPeriod; task: MapTaskFilter; today: string },
): MapView {
  const { byType, dates } = periodExpectation(alarm, weather, options.period, options.today);
  const selected: Partial<Record<TaskType, number>> =
    options.task === 'kaikki' ? byType : { [options.task]: byType[options.task] };
  const expected = cellExpected(spatial, selected);
  const total = expected.reduce((s, x) => s + x, 0);
  const mean = total / expected.length;

  const index = new Map(spatial.cellIds.map((id, i) => [id, i]));
  const cells: MapCell[] = grid.cells.map((cell) => {
    const i = index.get(cell.id)!;
    const e = expected[i]!;
    const ratio = mean > 0 ? e / mean : 0;
    const topTypes =
      options.task === 'kaikki' && e > 0
        ? TASK_TYPES.map((t) => ({ label: TASK_TYPE_LABELS[t], share: (byType[t] * spatial.shares[t][i]!) / e }))
            .sort((a, b) => b.share - a.share)
            .slice(0, 3)
        : [];
    return {
      id: cell.id,
      south: cell.south,
      west: cell.west,
      north: cell.north,
      east: cell.east,
      expected: e,
      ratio,
      riskClass: riskClassOf(ratio),
      description: describeCell(cell),
      topTypes,
    };
  });

  // Kärkiruudut: yksi per kuvaus, jotta lista ei täyty saman taajaman naapuriruuduista.
  const seen = new Set<string>();
  const hotspots = [...cells]
    .sort((a, b) => b.expected - a.expected)
    .filter((c) => (seen.has(c.description) ? false : (seen.add(c.description), true)))
    .slice(0, 3);

  return {
    periodLabel: MAP_PERIODS.find((p) => p.id === options.period)!.label,
    dates,
    taskLabel: options.task === 'kaikki' ? 'Kaikki tehtävät' : TASK_TYPE_LABELS[options.task],
    total,
    cells,
    hotspots,
  };
}
