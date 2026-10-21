// PRONTO-otteen jäsennys sovelluksen skeemaan. Puhtaat funktiot; tiedostojen luku ja kirjoitus
// tehdään skriptissä scripts/import-pronto.ts.
//
// Otteesta luetaan vain hälytysaika, onnettomuustyyppi, kiireellisyys ja koordinaatit. Muita
// sarakkeita (osoite, henkilömäärät, vahingot, syyt) ei käsitellä lainkaan.

import type { Grid, Incident, TaskType, Urgency } from './schema';

/** PRONTOn onnettomuustyypit sovelluksen tehtävätyypeiksi. */
export const PRONTO_TYPE_MAP: Record<string, TaskType> = {
  Rakennuspalo: 'rakennuspalo',
  Rakennuspalovaara: 'rakennuspalo',
  'Muu tarkastustehtävä': 'tarkastustehtava',
  'Muun paloilmoittimen tai palovaroittimen tarkastustehtävä': 'tarkastustehtava',
  'Häkeen liitetyn paloilmoittimen tarkastustehtävä': 'tarkastustehtava',
  'Automaattisen paloilmoittimen tarkastustehtävä': 'tarkastustehtava',
  Liikenneonnettomuus: 'liikenneonnettomuus',
  Vahingontorjuntatehtävä: 'vahingontorjunta',
  Öljyvahinko: 'vahingontorjunta',
  'Vaarallisten aineiden onnettomuus': 'vahingontorjunta',
  'Sortuma/sortumavaara': 'vahingontorjunta',
  Maastopalo: 'maastopalo',
  Liikennevälinepalo: 'muu_tulipalo',
  'Muu tulipalo': 'muu_tulipalo',
  'Virka-aputehtävä': 'muu',
  Avunantotehtävä: 'muu',
  'Eläimen pelastaminen': 'muu',
  Ensivastetehtävä: 'muu',
  'Ihmisen pelastaminen': 'muu',
};

export interface ProntoRecord {
  /** Yksikön hälytysaika, paikallinen aika YYYY-MM-DDTHH:mm:ss */
  alarmTime: string;
  prontoType: string;
  taskType: TaskType;
  urgency: Urgency;
  lat: number | null;
  lon: number | null;
}

export interface ProntoParseResult {
  records: ProntoRecord[];
  /** Tuntemattomat onnettomuustyypit (luokiteltu 'muu'), lukumäärineen */
  unknownTypes: Record<string, number>;
  /** Rivit, joilta puuttui kiireellisyys (oletettu C) */
  missingUrgency: number;
  /** Rivit, joiden hälytysaikaa ei voitu tulkita (ohitettu) */
  badTime: number;
}

const COLUMNS = {
  alarmTime: (h: string) => h === 'Hälytetty',
  type: (h: string) => h === 'Onnettomuustyyppi 1',
  urgency: (h: string) => h === 'Tehtävän resurssiluokitus',
  lat: (h: string) => h.startsWith('Pohjoiskoord'),
  lon: (h: string) => h.startsWith('Itäkoord'),
};

/** "N60°26.123'" tai "E23°14.5'" asteiksi. Muut muodot (esim. puuttuva arvo) null. */
export function parseDegreesMinutes(s: string): number | null {
  const m = /^[NE]?\s*(\d{1,3})°\s*(\d{1,2}(?:[.,]\d+)?)'?$/.exec(s.trim());
  if (!m) return null;
  const minutes = Number(m[2]!.replace(',', '.'));
  if (minutes >= 60) return null;
  return Number(m[1]) + minutes / 60;
}

/** "19.5.2024 15:54:29" muotoon "2024-05-19T15:54:29". */
export function parseProntoTime(s: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const pad = (x: string): string => x.padStart(2, '0');
  const [, d, mo, y, h, mi, sec] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23) return null;
  return `${y}-${pad(mo!)}-${pad(d!)}T${pad(h!)}:${mi}:${pad(sec ?? '00')}`;
}

/** Jäsentää PRONTO-otteen (sarake-erotin #, ensimmäinen rivi otsikot). */
export function parseProntoText(text: string): ProntoParseResult {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('tyhjä tiedosto');
  const header = lines[0]!.split('#').map((h) => h.trim());
  const col = (pick: (h: string) => boolean, name: string): number => {
    const i = header.findIndex(pick);
    if (i < 0) throw new Error(`sarake puuttuu: ${name}`);
    return i;
  };
  const iTime = col(COLUMNS.alarmTime, 'Hälytetty');
  const iType = col(COLUMNS.type, 'Onnettomuustyyppi 1');
  const iUrg = col(COLUMNS.urgency, 'Tehtävän resurssiluokitus');
  const iLat = col(COLUMNS.lat, 'Pohjoiskoord.');
  const iLon = col(COLUMNS.lon, 'Itäkoord.');

  const records: ProntoRecord[] = [];
  const unknownTypes: Record<string, number> = {};
  let missingUrgency = 0;
  let badTime = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('#');
    const alarmTime = parseProntoTime(cells[iTime] ?? '');
    if (!alarmTime) {
      badTime++;
      continue;
    }
    const prontoType = (cells[iType] ?? '').trim();
    let taskType = PRONTO_TYPE_MAP[prontoType];
    if (!taskType) {
      unknownTypes[prontoType] = (unknownTypes[prontoType] ?? 0) + 1;
      taskType = 'muu';
    }
    const u = /^([ABCD])-/.exec((cells[iUrg] ?? '').trim())?.[1] as Urgency | undefined;
    if (!u) missingUrgency++;
    records.push({
      alarmTime,
      prontoType,
      taskType,
      urgency: u ?? 'C',
      lat: parseDegreesMinutes(cells[iLat] ?? ''),
      lon: parseDegreesMinutes(cells[iLon] ?? ''),
    });
  }
  return { records, unknownTypes, missingUrgency, badTime };
}

const URGENCY_ORDER: Record<Urgency, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Sama hälytys voi olla otteessa useammin (esim. kaksi yksikköä). Rivit, joilla on sama
 * hälytysaika sekunnilleen, sama tehtävätyyppi ja sama paikka, yhdistetään; kiireellisin luokka jää.
 */
export function dedupe(records: readonly ProntoRecord[]): ProntoRecord[] {
  const byKey = new Map<string, ProntoRecord>();
  for (const r of records) {
    const key = `${r.alarmTime}|${r.taskType}|${r.lat?.toFixed(4)}|${r.lon?.toFixed(4)}`;
    const prev = byKey.get(key);
    if (!prev || URGENCY_ORDER[r.urgency] < URGENCY_ORDER[prev.urgency]) byKey.set(key, r);
  }
  return [...byKey.values()].sort((a, b) => (a.alarmTime < b.alarmTime ? -1 : a.alarmTime > b.alarmTime ? 1 : 0));
}

/** Ruutu, johon piste osuu, tai null jos ruudukon ulkopuolella. */
export function cellOf(grid: Grid, lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return null;
  const c = grid.cells.find((c) => lat >= c.south && lat < c.north && lon >= c.west && lon < c.east);
  return c ? c.id : null;
}

/**
 * Muuntaa tietueet skeeman hälytyksiksi. Aika pyöristetään alkavaan tuntiin: malli käyttää
 * vain tuntia, eikä tarkempaa aikaa julkaista.
 */
export function toIncidents(records: readonly ProntoRecord[], grid: Grid): Incident[] {
  const counter = new Map<string, number>();
  return records.map((r) => {
    const year = r.alarmTime.slice(0, 4);
    const n = (counter.get(year) ?? 0) + 1;
    counter.set(year, n);
    return {
      id: `P-${year}-${String(n).padStart(4, '0')}`,
      time: `${r.alarmTime.slice(0, 13)}:00`,
      taskType: r.taskType,
      urgency: r.urgency,
      cellId: cellOf(grid, r.lat, r.lon),
    };
  });
}

/**
 * Ruudukon rajat datasta: sijaintien 2. ja 98. persentiilin väli laajennettuna marginaalilla.
 * Yksittäiset kaukaiset hälytykset (esim. naapuriapu) eivät venytä karttaa, mutta ovat mukana
 * hälytysmallissa.
 */
export function boundsFromRecords(
  records: readonly ProntoRecord[],
  marginM = 2000,
): { south: number; west: number; north: number; east: number } {
  const lats = records.flatMap((r) => (r.lat === null || r.lon === null ? [] : [r.lat])).sort((a, b) => a - b);
  const lons = records.flatMap((r) => (r.lat === null || r.lon === null ? [] : [r.lon])).sort((a, b) => a - b);
  if (lats.length === 0) throw new Error('ei sijainteja');
  const q = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))]!;
  const midLat = (q(lats, 0.5) * Math.PI) / 180;
  const dLat = marginM / 111_320;
  const dLon = marginM / (111_320 * Math.cos(midLat));
  return {
    south: q(lats, 0.02) - dLat,
    north: q(lats, 0.98) + dLat,
    west: q(lons, 0.02) - dLon,
    east: q(lons, 0.98) + dLon,
  };
}
