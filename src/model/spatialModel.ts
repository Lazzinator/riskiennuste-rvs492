// Riskikartan malli: historiallinen hälytystiheys ruuduittain, tasoitettuna Gaussin ytimellä.
// Vähäinen data kutistetaan ensin kaikkien tehtävätyyppien yhteiseen tiheyteen ja se edelleen
// tasajakaumaan, jotta yksittäinen hälytys ei tee ruudusta "punaista".

import { distanceM } from '../data/geo';
import { TASK_TYPES, type Grid, type Incident, type TaskType } from '../data/schema';

export interface SpatialModel {
  cellIds: string[];
  bandwidthM: number;
  /** Tehtävätyypin hälytysten osuus ruuduittain, summa 1. */
  shares: Record<TaskType, number[]>;
  /** Kaikkien hälytysten osuus ruuduittain, summa 1. */
  pooled: number[];
}

export interface SpatialOptions {
  bandwidthM: number;
  /** Kutistus tyypistä yhteiseen tiheyteen (hälytysten määränä) */
  priorType: number;
  /** Kutistus yhteisestä tiheydestä tasajakaumaan */
  priorUniform: number;
}

export const DEFAULT_SPATIAL_OPTIONS: SpatialOptions = {
  bandwidthM: 1500,
  priorType: 10,
  priorUniform: 20,
};

export function fitSpatialModel(
  grid: Grid,
  incidents: readonly Incident[],
  options: Partial<SpatialOptions> = {},
): SpatialModel {
  const opt = { ...DEFAULT_SPATIAL_OPTIONS, ...options };
  const cells = grid.cells;
  const n = cells.length;
  const index = new Map(cells.map((c, i) => [c.id, i]));

  // Ydin: jokainen hälytys jakaa painon 1 lähiruutuihin (normalisoitu alueen reunoilla).
  const kernelCache = new Map<number, Array<[number, number]>>();
  const kernel = (i: number): Array<[number, number]> => {
    const cached = kernelCache.get(i);
    if (cached) return cached;
    const ci = cells[i]!;
    const out: Array<[number, number]> = [];
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const cj = cells[j]!;
      const d = distanceM([ci.centerLat, ci.centerLon], [cj.centerLat, cj.centerLon]);
      if (d > 3 * opt.bandwidthM) continue;
      const w = Math.exp(-0.5 * (d / opt.bandwidthM) ** 2);
      out.push([j, w]);
      sum += w;
    }
    for (const p of out) p[1] /= sum;
    kernelCache.set(i, out);
    return out;
  };

  const smoothed = Object.fromEntries(TASK_TYPES.map((t) => [t, new Array<number>(n).fill(0)])) as Record<
    TaskType,
    number[]
  >;
  const all = new Array<number>(n).fill(0);
  const typeCounts = Object.fromEntries(TASK_TYPES.map((t) => [t, 0])) as Record<TaskType, number>;
  let total = 0;
  for (const inc of incidents) {
    const i = index.get(inc.cellId);
    if (i === undefined) continue;
    for (const [j, w] of kernel(i)) {
      smoothed[inc.taskType][j]! += w;
      all[j]! += w;
    }
    typeCounts[inc.taskType]++;
    total++;
  }

  const pooled = all.map((k) => (k + opt.priorUniform / n) / (total + opt.priorUniform));
  const shares = {} as Record<TaskType, number[]>;
  for (const t of TASK_TYPES) {
    shares[t] = smoothed[t].map((k, j) => (k + opt.priorType * pooled[j]!) / (typeCounts[t] + opt.priorType));
  }
  return { cellIds: cells.map((c) => c.id), bandwidthM: opt.bandwidthM, shares, pooled };
}

/**
 * Odotettu hälytysmäärä ruuduittain annetulla tyyppikohtaisella ennusteella.
 * Ruudun riski on siis "missä" (historia) kerrottuna "milloin ja millä säällä" (hälytysmalli).
 */
export function cellExpected(
  spatial: SpatialModel,
  byType: Partial<Record<TaskType, number>>,
): number[] {
  const out = new Array<number>(spatial.cellIds.length).fill(0);
  for (const t of TASK_TYPES) {
    const e = byType[t];
    if (!e) continue;
    const s = spatial.shares[t];
    for (let j = 0; j < out.length; j++) out[j]! += e * s[j]!;
  }
  return out;
}
