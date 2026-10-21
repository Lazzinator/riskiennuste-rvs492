// Perttelin alueen yksinkertaistettu paikkatieto riskipainotuksia varten.
//
// Koordinaatit (WGS84):
// - Kaivola (Perttelin kirkonkylä, kirkko Kaivolantie 150): noin 60.447 N, 23.249 E.
//   Sama piste on entisen Perttelin kunnan koordinaatti Wikipediassa.
// - Inkere (entinen hallinnollinen keskus, Inkereen koulu): noin 60.432 N, 23.266 E.
// Tielinjaukset ja aluerajaus ovat karkeita murtoviivoja ja monikulmioita, jotka on
// tarkoitus tarkistaa OpenStreetMap-taustaa vasten riskikarttavaiheessa. Ne riittävät
// simulaation painotukseen, mutta eivät ole virallisia rajoja.

import type { Grid, GridCell, TaskType } from './schema';

export type LatLon = readonly [lat: number, lon: number];

/** Kartan oletuskeskipiste: Inkereen ja Kaivolan välissä. */
export const AREA_CENTER: LatLon = [60.44, 23.26];

/** Entisen Perttelin kunnan karkea rajaus (myötäpäivään). Salon keskusta jää ulkopuolelle. */
export const AREA_POLYGON: readonly LatLon[] = [
  [60.385, 23.16],
  [60.375, 23.3],
  [60.38, 23.42],
  [60.45, 23.45],
  [60.53, 23.44],
  [60.56, 23.33],
  [60.55, 23.18],
  [60.5, 23.12],
  [60.43, 23.12],
  [60.405, 23.14],
];

export interface Road {
  name: string;
  /** 1 = moottoritie, pienempi = vähemmän liikennettä */
  trafficWeight: number;
  points: readonly LatLon[];
}

export const ROADS: readonly Road[] = [
  {
    name: 'E18 Turku-Helsinki-moottoritie',
    trafficWeight: 1.0,
    points: [
      [60.405, 23.12],
      [60.4, 23.2],
      [60.392, 23.28],
      [60.385, 23.36],
      [60.375, 23.43],
    ],
  },
  {
    name: 'Kantatie 52 (Salo-Somero)',
    trafficWeight: 0.7,
    points: [
      [60.395, 23.15],
      [60.415, 23.22],
      [60.432, 23.262],
      [60.47, 23.32],
      [60.51, 23.38],
      [60.55, 23.43],
    ],
  },
  {
    name: 'Kaivolantie ja pohjoiset kylätiet',
    trafficWeight: 0.3,
    points: [
      [60.432, 23.266],
      [60.448, 23.245],
      [60.49, 23.22],
      [60.54, 23.2],
    ],
  },
];

export interface Settlement {
  name: string;
  /** Taivutusmuodot kuvauksiin: "Inkereen lähistö", "Inkereeltä 3 km pohjoiseen" */
  genitive: string;
  elative: string;
  center: LatLon;
  /** Suhteellinen asukas- ja rakennustiheys */
  weight: number;
  /** Taajaman säde metreinä (Gaussin hajonta) */
  radiusM: number;
}

export const SETTLEMENTS: readonly Settlement[] = [
  { name: 'Inkere', genitive: 'Inkereen', elative: 'Inkereeltä', center: [60.432, 23.266], weight: 1.0, radiusM: 1500 },
  { name: 'Kaivola', genitive: 'Kaivolan', elative: 'Kaivolasta', center: [60.447, 23.249], weight: 0.7, radiusM: 1200 },
];

const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat: number): number => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Etäisyys metreinä (tasoprojektio riittää näin pienellä alueella). */
export function distanceM(a: LatLon, b: LatLon): number {
  const dy = (a[0] - b[0]) * M_PER_DEG_LAT;
  const dx = (a[1] - b[1]) * mPerDegLon((a[0] + b[0]) / 2);
  return Math.hypot(dx, dy);
}

/** Pisteen etäisyys murtoviivasta metreinä. */
export function distanceToPolylineM(p: LatLon, line: readonly LatLon[]): number {
  const kx = mPerDegLon(p[0]);
  const ky = M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const ax = (a[1] - p[1]) * kx;
    const ay = (a[0] - p[0]) * ky;
    const bx = (b[1] - p[1]) * kx;
    const by = (b[0] - p[0]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function pointInPolygon(p: LatLon, poly: readonly LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Muodostaa ruudukon annetuille rajoille. Ruudun tunniste kertoo rivin ja sarakkeen.
 * include rajaa ruudut keskipisteen perusteella (oletus: kaikki).
 */
export function buildGridForBounds(
  b: Bounds,
  cellSizeM = 1000,
  include: (center: LatLon) => boolean = () => true,
): Grid {
  const dLat = cellSizeM / M_PER_DEG_LAT;
  const dLon = cellSizeM / mPerDegLon((b.south + b.north) / 2);
  const rows = Math.ceil((b.north - b.south) / dLat);
  const cols = Math.ceil((b.east - b.west) / dLon);
  const round = (x: number): number => Math.round(x * 1e6) / 1e6;

  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = b.south + r * dLat;
      const w = b.west + c * dLon;
      const center: LatLon = [s + dLat / 2, w + dLon / 2];
      if (!include(center)) continue;
      cells.push({
        id: `r${r}c${c}`,
        row: r,
        col: c,
        south: round(s),
        west: round(w),
        north: round(s + dLat),
        east: round(w + dLon),
        centerLat: round(center[0]),
        centerLon: round(center[1]),
      });
    }
  }
  return { cellSizeM, cells };
}

/** Simulaation ruudukko: ruudut, joiden keskipiste on aluerajauksen sisällä. */
export function buildGrid(cellSizeM = 1000, polygon: readonly LatLon[] = AREA_POLYGON): Grid {
  const lats = polygon.map((p) => p[0]);
  const lons = polygon.map((p) => p[1]);
  const bounds = { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
  return buildGridForBounds(bounds, cellSizeM, (center) => pointInPolygon(center, polygon));
}

/** Ruudun maankäyttöpiirteet 0..1 asteikolla. */
export interface CellFeatures {
  /** Pääteiden läheisyys liikennemäärällä painotettuna */
  majorRoad: number;
  /** Pienempien teiden läheisyys */
  minorRoad: number;
  /** Taajamaisuus */
  settlement: number;
  /** Metsäisyys */
  forest: number;
}

/** Deterministinen kohina ruudun sijainnista, jotta metsäisyys ei ole liian sileä. */
function hashNoise(row: number, col: number): number {
  let h = Math.imul(row * 73856093, 1) ^ Math.imul(col * 19349663, 1);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function cellFeatures(cell: GridCell): CellFeatures {
  const p: LatLon = [cell.centerLat, cell.centerLon];
  let majorRoad = 0;
  let minorRoad = 0;
  for (const road of ROADS) {
    const d = distanceToPolylineM(p, road.points);
    const near = Math.exp(-((d / 600) ** 2));
    if (road.trafficWeight >= 0.5) majorRoad = Math.max(majorRoad, near * road.trafficWeight);
    else minorRoad = Math.max(minorRoad, near);
  }
  let settlement = 0;
  for (const s of SETTLEMENTS) {
    const d = distanceM(p, s.center);
    settlement += s.weight * Math.exp(-((d / s.radiusM) ** 2));
  }
  settlement = Math.min(1, settlement);

  // Metsää enemmän pohjoisessa ja kaukana taajamista ja pääteistä (peltoja on jokilaaksossa etelässä).
  const northness = Math.max(0, Math.min(1, (cell.centerLat - 60.38) / 0.18));
  const noise = 0.7 + 0.6 * hashNoise(cell.row, cell.col);
  const forest = Math.min(
    1,
    (0.25 + 0.75 * northness) * noise * (1 - 0.9 * settlement) * (1 - 0.5 * majorRoad),
  );
  return { majorRoad, minorRoad, settlement, forest };
}

/** Tehtävätyypin suhteellinen paino ruudussa. Ei normalisoitu. */
export function spatialWeight(type: TaskType, f: CellFeatures): number {
  switch (type) {
    case 'liikenneonnettomuus':
      return 0.03 + 2.5 * f.majorRoad + 0.6 * f.minorRoad;
    case 'rakennuspalo':
      return 0.3 + 1.2 * f.settlement;
    case 'maastopalo':
      return 0.05 + 1.0 * f.forest;
    case 'muu_tulipalo':
      return 0.25 + 0.8 * f.settlement + 0.5 * f.majorRoad;
    case 'vahingontorjunta':
      return 0.35 + 0.8 * f.settlement + 0.3 * f.majorRoad;
    case 'tarkastustehtava':
      return 0.02 + 2.0 * f.settlement;
    case 'muu':
      return 0.35 + 0.5 * f.settlement + 0.3 * f.forest;
  }
}

const DIRECTIONS = ['pohjoiseen', 'koilliseen', 'itään', 'kaakkoon', 'etelään', 'lounaaseen', 'länteen', 'luoteeseen'];

/** Ilmansuunta pisteestä a pisteeseen b illatiivissa, esim. "pohjoiseen". */
export function directionTo(a: LatLon, b: LatLon): string {
  const dy = b[0] - a[0];
  const dx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return DIRECTIONS[Math.round(bearing / 45) % 8]!;
}

/**
 * Paikat ruutujen kuvauksiin. Taajamien lisäksi Salon keskusta, koska RVS492:n hälytyksiä on myös
 * Perttelin ulkopuolella. (Simulaation painotukset käyttävät vain SETTLEMENTS-listaa.)
 */
export const PLACES: readonly Settlement[] = [
  ...SETTLEMENTS,
  { name: 'Salon keskusta', genitive: 'Salon keskustan', elative: 'Salon keskustasta', center: [60.3842, 23.1253], weight: 0, radiusM: 1500 },
];

/**
 * Ruudun kuvaus käyttöliittymään lähimmän paikan mukaan, esim. "Inkere", "Kaivolan lähistö" tai
 * "Kaivolasta 6 km koilliseen". Ei osoitteita.
 */
export function describeCell(cell: GridCell): string {
  const p: LatLon = [cell.centerLat, cell.centerLon];
  const nearest = PLACES.map((s) => ({ s, d: distanceM(p, s.center) })).sort((a, b) => a.d - b.d)[0]!;
  if (nearest.d <= nearest.s.radiusM) return nearest.s.name;
  if (nearest.d <= 2.5 * nearest.s.radiusM) return `${nearest.s.genitive} lähistö`;
  return `${nearest.s.elative} ${Math.round(nearest.d / 1000)} km ${directionTo(nearest.s.center, p)}`;
}
