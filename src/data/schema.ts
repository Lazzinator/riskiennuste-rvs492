// Yhteinen dataskeema. Sekä simuloitu data että myöhemmin CSV:stä tuotava oikea data
// muunnetaan tähän muotoon, jotta malli ja käyttöliittymä eivät riipu datan lähteestä.

/** Tehtävätyypit. Tunniste pysyy vakaana, nimi on käyttöliittymää varten. */
export const TASK_TYPES = [
  'ensivaste',
  'liikenneonnettomuus',
  'rakennuspalo',
  'maastopalo',
  'muu_tulipalo',
  'vahingontorjunta',
  'automaattinen_paloilmoitus',
  'muu',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  ensivaste: 'Ensivaste ja avunanto',
  liikenneonnettomuus: 'Liikenneonnettomuus',
  rakennuspalo: 'Rakennuspalo',
  maastopalo: 'Maastopalo',
  muu_tulipalo: 'Muu tulipalo',
  vahingontorjunta: 'Vahingontorjunta',
  automaattinen_paloilmoitus: 'Automaattinen paloilmoitus',
  muu: 'Eläinpelastus ja muu',
};

/** Kiireellisyysluokat A (kiireellisin) ... D. */
export const URGENCIES = ['A', 'B', 'C', 'D'] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * Yksi hälytys. Sijainti tallennetaan vain ruudun tunnisteena, ei tarkkana pisteenä.
 * Aika on Suomen paikallista aikaa muodossa YYYY-MM-DDTHH:mm, jotta aikavyöhykkeet
 * eivät sotke tunti- ja viikonpäiväjakaumia.
 */
export interface Incident {
  id: string;
  /** Paikallinen aika, esim. "2023-05-14T18:40". */
  time: string;
  taskType: TaskType;
  urgency: Urgency;
  /** Viittaus GridCell.id:hen. */
  cellId: string;
}

/**
 * Päivän sää. Arvot vastaavat Ilmatieteen laitoksen päivätilastoja, jotta oikean
 * säädatan voi tuoda samaan muotoon.
 */
export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  /** Vuorokauden keskilämpötila, °C */
  tempMean: number;
  tempMin: number;
  tempMax: number;
  /** Vuorokauden sademäärä, mm */
  precipMm: number;
  /** Lumensyvyys aamulla, cm */
  snowDepthCm: number;
  /** Keskituuli, m/s */
  windMs: number;
  /** Liukkaus 0 = ei, 1 = paikoin, 2 = liukas, 3 = erittäin liukas */
  slipperiness: 0 | 1 | 2 | 3;
}

/** Riskikartan ruutu. Rajat WGS84-asteina. */
export interface GridCell {
  id: string;
  row: number;
  col: number;
  south: number;
  west: number;
  north: number;
  east: number;
  centerLat: number;
  centerLon: number;
}

export interface Grid {
  /** Ruudun sivun pituus metreinä. */
  cellSizeM: number;
  cells: GridCell[];
}

export type DataSource = 'simulated' | 'pronto';

export interface DatasetMeta {
  source: DataSource;
  /** Simuloidussa datassa siemenluku, oikeassa datassa null. */
  seed: number | null;
  /** Ensimmäinen ja viimeinen päivä, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  incidentCount: number;
  schemaVersion: number;
  note: string;
}

export interface Dataset {
  meta: DatasetMeta;
  grid: Grid;
  weather: WeatherDay[];
  incidents: Incident[];
}

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Validointi. Käytetään sekä testeissä että myöhemmin oikean datan tuonnissa.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
}

export function isUrgency(v: unknown): v is Urgency {
  return typeof v === 'string' && (URGENCIES as readonly string[]).includes(v);
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidTime(s: string): boolean {
  if (!TIME_RE.test(s)) return false;
  const hh = Number(s.slice(11, 13));
  const mm = Number(s.slice(14, 16));
  return isValidDate(s.slice(0, 10)) && hh < 24 && mm < 60;
}

/** Palauttaa virhelistan. Tyhjä lista = kelvollinen. */
export function validateIncident(inc: Incident, cellIds?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!inc.id) errors.push('id puuttuu');
  if (!isValidTime(inc.time)) errors.push(`virheellinen aika: ${inc.time}`);
  if (!isTaskType(inc.taskType)) errors.push(`tuntematon tehtävätyyppi: ${inc.taskType}`);
  if (!isUrgency(inc.urgency)) errors.push(`tuntematon kiireellisyys: ${inc.urgency}`);
  if (cellIds && !cellIds.has(inc.cellId)) errors.push(`tuntematon ruutu: ${inc.cellId}`);
  return errors.map((e) => `${inc.id || '?'}: ${e}`);
}

export function validateWeatherDay(w: WeatherDay): string[] {
  const errors: string[] = [];
  if (!isValidDate(w.date)) errors.push(`virheellinen päivä: ${w.date}`);
  if (!(w.tempMin <= w.tempMean && w.tempMean <= w.tempMax)) errors.push('lämpötilat ristiriitaiset');
  if (w.tempMin < -45 || w.tempMax > 40) errors.push('lämpötila epärealistinen');
  if (w.precipMm < 0) errors.push('negatiivinen sademäärä');
  if (w.snowDepthCm < 0) errors.push('negatiivinen lumensyvyys');
  if (w.windMs < 0) errors.push('negatiivinen tuuli');
  if (![0, 1, 2, 3].includes(w.slipperiness)) errors.push('virheellinen liukkaus');
  return errors.map((e) => `${w.date}: ${e}`);
}

export function validateDataset(ds: Dataset): string[] {
  const errors: string[] = [];
  const cellIds = new Set(ds.grid.cells.map((c) => c.id));
  if (cellIds.size !== ds.grid.cells.length) errors.push('ruutujen tunnisteet eivät ole yksikäsitteisiä');
  const ids = new Set<string>();
  for (const inc of ds.incidents) {
    errors.push(...validateIncident(inc, cellIds));
    if (ids.has(inc.id)) errors.push(`${inc.id}: tunniste toistuu`);
    ids.add(inc.id);
    const day = inc.time.slice(0, 10);
    if (day < ds.meta.startDate || day > ds.meta.endDate) errors.push(`${inc.id}: aikavälin ulkopuolella`);
  }
  for (const w of ds.weather) errors.push(...validateWeatherDay(w));
  if (ds.meta.incidentCount !== ds.incidents.length) errors.push('meta.incidentCount ei täsmää');
  return errors;
}

// ---------------------------------------------------------------------------
// Aikaapurit (paikallinen aika ilman aikavyöhykettä).
// ---------------------------------------------------------------------------

/** Kuukausi 0-11 */
export function monthOf(time: string): number {
  return Number(time.slice(5, 7)) - 1;
}

/** Tunti 0-23 */
export function hourOf(time: string): number {
  return Number(time.slice(11, 13));
}

/** Viikonpäivä 0 = maanantai ... 6 = sunnuntai (suomalainen järjestys). */
export function weekdayOf(dateOrTime: string): number {
  const d = new Date(`${dateOrTime.slice(0, 10)}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}
