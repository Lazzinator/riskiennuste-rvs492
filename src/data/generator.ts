// Simuloidun datan generaattori. Puhtaat funktiot, jotta testit voivat ajaa niitä suoraan.
// Komentorivikäyttö: scripts/generate-data.ts.
//
// Huom: nämä kertoimet ovat simulaation "totuus". Malli (vaihe 2) ei saa käyttää niitä,
// vaan sen pitää estimoida kertoimet datasta, kuten oikeallakin datalla.

import { buildGrid, cellFeatures, spatialWeight } from './geo';
import { createRng, type Rng } from './rng';
import { daysSinceRain, temperatureChange } from './weather';
import {
  SCHEMA_VERSION,
  TASK_TYPES,
  URGENCIES,
  type Dataset,
  type Grid,
  type Incident,
  type TaskType,
  type Urgency,
  type WeatherDay,
} from './schema';

export interface GeneratorConfig {
  seed: number;
  startYear: number;
  /** Mukaan lukien */
  endYear: number;
  cellSizeM: number;
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  seed: 492,
  startYear: 2021,
  endYear: 2025,
  cellSizeM: 1000,
};

/** Odotettu hälytysmäärä vuodessa tehtävätyypeittäin. Summa noin 57. */
export const ANNUAL_TARGETS: Record<TaskType, number> = {
  ensivaste: 14,
  liikenneonnettomuus: 10,
  rakennuspalo: 4,
  maastopalo: 5,
  muu_tulipalo: 5,
  vahingontorjunta: 6,
  automaattinen_paloilmoitus: 7,
  muu: 6,
};

/** Kiireellisyysluokkien todennäköisyydet A, B, C, D. */
const URGENCY_PROBS: Record<TaskType, readonly [number, number, number, number]> = {
  ensivaste: [0.25, 0.5, 0.2, 0.05],
  liikenneonnettomuus: [0.3, 0.5, 0.15, 0.05],
  rakennuspalo: [0.6, 0.35, 0.05, 0],
  maastopalo: [0.1, 0.5, 0.35, 0.05],
  muu_tulipalo: [0.1, 0.5, 0.35, 0.05],
  vahingontorjunta: [0, 0.1, 0.5, 0.4],
  automaattinen_paloilmoitus: [0, 0.85, 0.15, 0],
  muu: [0, 0.05, 0.4, 0.55],
};

// Kuukausikertoimet tammi...joulu
const MONTH_FACTORS: Record<TaskType, readonly number[]> = {
  ensivaste: [1, 1, 1, 1, 1, 1.1, 1.15, 1.1, 1, 1, 1, 1.05],
  liikenneonnettomuus: [1.3, 1.2, 1.0, 0.85, 0.85, 0.95, 1.05, 0.95, 0.9, 1.0, 1.15, 1.3],
  // Talven ylimäärä tulee pääosin lämmityksestä (sääkerroin), kuukausi kuvaa lähinnä joulua ja saunomista.
  rakennuspalo: [1.1, 1.05, 1.0, 0.95, 0.9, 0.9, 0.95, 0.9, 0.9, 1.0, 1.05, 1.25],
  maastopalo: [0.05, 0.05, 0.3, 2.5, 3.0, 2.2, 1.4, 1.0, 0.5, 0.2, 0.05, 0.05],
  muu_tulipalo: [0.9, 0.8, 0.9, 1.2, 1.3, 1.2, 1.2, 1.1, 0.9, 0.9, 0.8, 1.0],
  vahingontorjunta: [1.2, 1.0, 0.9, 0.9, 0.8, 0.9, 1.0, 1.1, 1.0, 1.2, 1.2, 1.2],
  automaattinen_paloilmoitus: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  muu: [0.8, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.2, 1.1, 0.9, 0.9, 0.8],
};

// Viikonpäiväkertoimet ma...su
const WEEKDAY_FACTORS: Record<TaskType, readonly number[]> = {
  ensivaste: [1, 1, 1, 1, 1.05, 1.1, 1.0],
  liikenneonnettomuus: [0.9, 0.9, 0.9, 1.0, 1.3, 1.15, 1.0],
  rakennuspalo: [0.9, 0.9, 0.9, 0.95, 1.05, 1.3, 1.15],
  maastopalo: [0.9, 0.9, 0.9, 0.95, 1.05, 1.25, 1.2],
  muu_tulipalo: [0.9, 0.9, 0.9, 0.95, 1.15, 1.25, 1.1],
  vahingontorjunta: [1, 1, 1, 1, 1, 1, 1],
  automaattinen_paloilmoitus: [1.15, 1.15, 1.15, 1.15, 1.1, 0.7, 0.6],
  muu: [0.95, 0.95, 0.95, 0.95, 1.05, 1.15, 1.1],
};

// Tuntiprofiilit 0...23
const HOUR_PROFILES = {
  generic: [
    0.4, 0.35, 0.3, 0.3, 0.3, 0.35, 0.5, 0.7, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.35, 1.45,
    1.5, 1.5, 1.45, 1.35, 1.2, 0.9, 0.6,
  ],
  traffic: [
    0.35, 0.3, 0.25, 0.2, 0.25, 0.4, 0.9, 1.4, 1.4, 0.9, 0.8, 0.85, 0.9, 1.0, 1.2, 1.6, 1.8, 1.7,
    1.4, 1.2, 1.1, 1.0, 0.8, 0.5,
  ],
  building: [
    0.6, 0.55, 0.5, 0.5, 0.45, 0.45, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 1.0, 1.0, 1.05, 1.15, 1.3,
    1.5, 1.6, 1.7, 1.6, 1.4, 1.1, 0.8,
  ],
  alarm: [
    0.4, 0.35, 0.3, 0.3, 0.3, 0.35, 0.6, 1.0, 1.6, 1.8, 1.8, 1.7, 1.7, 1.7, 1.6, 1.5, 1.2, 1.0,
    0.9, 0.85, 0.8, 0.7, 0.55, 0.45,
  ],
  wildland: [
    0.08, 0.06, 0.05, 0.05, 0.05, 0.08, 0.15, 0.3, 0.5, 0.8, 1.2, 1.6, 2.0, 2.2, 2.3, 2.3, 2.2,
    2.0, 1.7, 1.3, 0.9, 0.6, 0.3, 0.15,
  ],
} as const;

const HOUR_PROFILE_OF: Record<TaskType, readonly number[]> = {
  ensivaste: HOUR_PROFILES.generic,
  liikenneonnettomuus: HOUR_PROFILES.traffic,
  rakennuspalo: HOUR_PROFILES.building,
  maastopalo: HOUR_PROFILES.wildland,
  muu_tulipalo: HOUR_PROFILES.building,
  vahingontorjunta: HOUR_PROFILES.generic,
  automaattinen_paloilmoitus: HOUR_PROFILES.alarm,
  muu: HOUR_PROFILES.generic,
};

// ---------------------------------------------------------------------------
// Päivämääräapurit
// ---------------------------------------------------------------------------

function* daysBetween(startYear: number, endYear: number): Generator<Date> {
  const d = new Date(Date.UTC(startYear, 0, 1));
  const end = Date.UTC(endYear, 11, 31);
  while (d.getTime() <= end) {
    yield new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const pad2 = (n: number): string => String(n).padStart(2, '0');
// "|| 0" poistaa negatiivisen nollan, joka ei säily JSON-muunnoksessa.
const round1 = (x: number): number => Math.round(x * 10) / 10 || 0;

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Sää
// ---------------------------------------------------------------------------

// Lounais-Suomen (Salo) ilmastoa karkeasti vastaavat kuukausiarvot.
const CLIMATE_TEMP = [-4, -4.5, -1.5, 4, 10, 14.5, 17.5, 16, 11, 5.5, 1, -2];
const CLIMATE_WET_PROB = [0.5, 0.42, 0.4, 0.36, 0.36, 0.42, 0.45, 0.48, 0.48, 0.52, 0.55, 0.55];
const CLIMATE_WET_MEAN_MM = [2.8, 2.5, 2.3, 2.3, 2.7, 3.6, 4.5, 5.0, 4.0, 4.3, 4.0, 3.2];
const CLIMATE_WIND = [4.6, 4.4, 4.1, 3.7, 3.4, 3.2, 3.0, 3.1, 3.5, 4.0, 4.4, 4.6];

/** Lineaarinen interpolointi kuukausien keskikohtien välillä. */
function seasonal(values: readonly number[], doy: number): number {
  const m = (doy / 365.25) * 12 - 0.5;
  const i = Math.floor(m);
  const t = m - i;
  const a = values[((i % 12) + 12) % 12]!;
  const b = values[(((i + 1) % 12) + 12) % 12]!;
  return a + (b - a) * t;
}

/** Sääsimulaation tila, jotta jaksoa voi jatkaa katkeamatta (esim. historiasta nykyhetkeen). */
export interface WeatherState {
  anomaly: number;
  wet: boolean;
  snow: number;
  prev: WeatherDay | null;
}

export const INITIAL_WEATHER_STATE: WeatherState = { anomaly: 0, wet: false, snow: 0, prev: null };

export function simulateWeather(
  rng: Rng,
  startYear: number,
  endYear: number,
  state: WeatherState = INITIAL_WEATHER_STATE,
): { weather: WeatherDay[]; state: WeatherState } {
  const out: WeatherDay[] = [];
  let { anomaly, wet, snow, prev } = state;
  const phi = 0.85;

  for (const d of daysBetween(startYear, endYear)) {
    const doy = dayOfYear(d);
    const month = d.getUTCMonth();
    const winterness = Math.max(0, Math.min(1, (6 - seasonal(CLIMATE_TEMP, doy)) / 10));
    const anomalySd = 2.5 + 2.5 * winterness;
    anomaly = phi * anomaly + rng.normal(0, anomalySd * Math.sqrt(1 - phi * phi));
    const tempMean = seasonal(CLIMATE_TEMP, doy) + anomaly;
    const range = Math.max(1, 4 + 4 * (1 - winterness) + rng.normal(0, 1.5));
    const tempMin = tempMean - range / 2;
    const tempMax = tempMean + range / 2;

    // Sadepäivät Markovin ketjuna: sade jatkuu todennäköisemmin kuin alkaa.
    const p = CLIMATE_WET_PROB[month]!;
    wet = rng.next() < (wet ? Math.min(0.9, p + 0.18) : Math.max(0.05, p - 0.12));
    const precipMm = wet ? -Math.log(1 - rng.next()) * CLIMATE_WET_MEAN_MM[month]! : 0;

    // Lumi: sade tulee lumena pakkasella, sulaa astepäivämallilla.
    const snowfallCm = tempMean < 0.5 ? precipMm : 0;
    const melt = tempMax > 0 ? 1.0 * Math.max(0, tempMean + 1) : 0;
    snow = Math.max(0, snow * 0.99 + snowfallCm - melt);

    let wind = CLIMATE_WIND[month]! * Math.exp(rng.normal(0, 0.35));
    // Satunnaiset myrskypäivät, useimmin syksyllä ja talvella.
    if (rng.next() < 0.004 + 0.012 * winterness) wind += 5 + 6 * rng.next();

    let slip = 0;
    if (tempMin <= 0.5) {
      const nearZero = tempMax >= -1.5;
      if (snowfallCm >= 3) slip = Math.max(slip, 2);
      if (nearZero && precipMm > 0.3) slip = Math.max(slip, 2);
      if (tempMean > -1.5 && tempMean < 1.5 && precipMm >= 2 && snowfallCm === 0) slip = 3;
      if (prev && (prev.precipMm > 0.5 || (prev.tempMax > 0 && snow > 0))) slip = Math.max(slip, 1);
      if (nearZero && snow > 0) slip = Math.max(slip, 1);
    }

    const day: WeatherDay = {
      date: isoDate(d),
      tempMean: round1(tempMean),
      tempMin: round1(tempMin),
      tempMax: round1(tempMax),
      precipMm: round1(precipMm),
      snowDepthCm: Math.round(snow),
      windMs: round1(wind),
      slipperiness: slip as WeatherDay['slipperiness'],
    };
    out.push(day);
    prev = day;
  }
  return { weather: out, state: { anomaly, wet, snow, prev } };
}

// ---------------------------------------------------------------------------
// Hälytykset
// ---------------------------------------------------------------------------

interface DayContext {
  w: WeatherDay;
  dry: number;
  /** Keskilämpötilan muutos edellisen viikon keskiarvoon, °C */
  tempChange: number;
}

/** Sään vaikutus tehtävätyypin intensiteettiin (kerroin). */
export function weatherFactor(type: TaskType, { w, dry, tempChange }: DayContext): number {
  switch (type) {
    case 'liikenneonnettomuus':
      return (1 + 0.5 * w.slipperiness) * (w.precipMm >= 5 && w.tempMean < 0.5 ? 1.4 : 1);
    case 'rakennuspalo': {
      // Lämmitys: tulisijojen ja hormien käyttö kasvaa sään kylmetessä (savukaasut, nokipalot,
      // huonokuntoisesta hormista yläpohjaan leviävät palot). Lämmitysraja noin +15 °C.
      const heating = 1 + 0.05 * Math.max(0, 15 - w.tempMean);
      // Jyrkkä kylmeneminen: lämmitystä lisätään äkillisesti ja käyttämättömät hormit otetaan käyttöön.
      const cooling = tempChange <= -5 && w.tempMean < 10 ? 1.6 : 1;
      return heating * cooling;
    }
    case 'maastopalo': {
      if (w.snowDepthCm > 0) return 0.02;
      const dryness = Math.min(dry, 20) / 10;
      const warmth = 1 + Math.max(0, w.tempMax - 10) / 10;
      const rain = w.precipMm >= 2 ? 0.2 : 1;
      return (0.15 + dryness) * warmth * (1 + 0.1 * w.windMs) * rain;
    }
    case 'muu_tulipalo':
      return 1 + 0.03 * Math.min(dry, 15);
    case 'vahingontorjunta':
      return 1 + 0.4 * Math.max(0, w.windMs - 8) + (w.precipMm >= 15 ? 1.5 : 0);
    case 'ensivaste':
      return 1 + 0.15 * w.slipperiness;
    case 'automaattinen_paloilmoitus':
    case 'muu':
      return 1;
  }
}

/** Viikonloppuöiden lisäkerroin liikenteelle (pe ja la klo 22-03). */
function weekendNightFactor(type: TaskType, weekday: number, hour: number): number {
  if (type !== 'liikenneonnettomuus') return 1;
  const fridayOrSaturdayNight =
    ((weekday === 4 || weekday === 5) && hour >= 22) || ((weekday === 5 || weekday === 6) && hour <= 3);
  return fridayOrSaturdayNight ? 1.6 : 1;
}

export function generateIncidents(
  rng: Rng,
  weather: readonly WeatherDay[],
  grid: Grid,
): Incident[] {
  const years = new Set(weather.map((w) => w.date.slice(0, 4))).size;
  const dry = daysSinceRain(weather);
  const tempChange = temperatureChange(weather);
  const hours = weather.length * 24;

  // 1) Suhteellinen intensiteetti joka tunnille ja tyypille.
  const raw: Record<TaskType, Float64Array> = {} as Record<TaskType, Float64Array>;
  for (const type of TASK_TYPES) {
    const arr = new Float64Array(hours);
    const hp = HOUR_PROFILE_OF[type];
    for (let i = 0; i < weather.length; i++) {
      const w = weather[i]!;
      const month = Number(w.date.slice(5, 7)) - 1;
      const weekday = (new Date(`${w.date}T00:00:00Z`).getUTCDay() + 6) % 7;
      const dayF =
        MONTH_FACTORS[type][month]! *
        WEEKDAY_FACTORS[type][weekday]! *
        weatherFactor(type, { w, dry: dry[i]!, tempChange: tempChange[i]! });
      for (let h = 0; h < 24; h++) {
        arr[i * 24 + h] = dayF * hp[h]! * weekendNightFactor(type, weekday, h);
      }
    }
    raw[type] = arr;
  }

  // 2) Skaalataan niin, että odotusarvo vastaa vuositavoitetta.
  const scale: Record<TaskType, number> = {} as Record<TaskType, number>;
  for (const type of TASK_TYPES) {
    let sum = 0;
    for (const v of raw[type]) sum += v;
    scale[type] = (ANNUAL_TARGETS[type] * years) / sum;
  }

  // 3) Ruutujen painot tyypeittäin.
  const features = grid.cells.map(cellFeatures);
  const cellWeights: Record<TaskType, number[]> = {} as Record<TaskType, number[]>;
  for (const type of TASK_TYPES) cellWeights[type] = features.map((f) => spatialWeight(type, f));

  // 4) Poisson-arvonta tunneittain.
  const incidents: Incident[] = [];
  for (let i = 0; i < weather.length; i++) {
    const date = weather[i]!.date;
    for (let h = 0; h < 24; h++) {
      for (const type of TASK_TYPES) {
        const k = rng.poisson(raw[type][i * 24 + h]! * scale[type]);
        for (let j = 0; j < k; j++) {
          const urgency: Urgency = URGENCIES[rng.weighted(URGENCY_PROBS[type])]!;
          const cell = grid.cells[rng.weighted(cellWeights[type])]!;
          incidents.push({
            id: '', // numeroidaan alla aikajärjestyksessä
            time: `${date}T${pad2(h)}:${pad2(rng.int(0, 59))}`,
            taskType: type,
            urgency,
            cellId: cell.id,
          });
        }
      }
    }
  }
  // Lajittelu on vakaa, joten saman minuutin tapahtumat pysyvät arvontajärjestyksessä.
  incidents.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const counter = new Map<string, number>();
  for (const inc of incidents) {
    const year = inc.time.slice(0, 4);
    const n = (counter.get(year) ?? 0) + 1;
    counter.set(year, n);
    inc.id = `SIM-${year}-${String(n).padStart(4, '0')}`;
  }
  return incidents;
}

export function generateDataset(config: Partial<GeneratorConfig> = {}): Dataset {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (cfg.endYear < cfg.startYear) throw new Error('endYear < startYear');
  const rng = createRng(cfg.seed);
  const grid = buildGrid(cfg.cellSizeM);
  const weather = simulateWeather(rng, cfg.startYear, cfg.endYear).weather;
  const incidents = generateIncidents(rng, weather, grid);
  return {
    meta: {
      source: 'simulated',
      seed: cfg.seed,
      startDate: weather[0]!.date,
      endDate: weather[weather.length - 1]!.date,
      incidentCount: incidents.length,
      schemaVersion: SCHEMA_VERSION,
      note: 'Simuloitu data. Ei perustu todellisiin hälytyksiin eikä ole virallinen ennuste.',
    },
    grid,
    weather,
    incidents,
  };
}

/** Montako vuotta simuloitua "nykysäätä" tuotetaan historian jälkeen. */
export const CURRENT_WEATHER_YEARS = 3;

/**
 * Simuloitu sää historian jälkeisille vuosille (pilotin "tämän päivän sää" ja viikon ennuste).
 * Jatkaa historian säätä samasta tilasta, joten lumipeite ja kuivat jaksot eivät katkea
 * vuodenvaihteessa. Käyttää omaa satunnaislukujonoa, joten historia ei muutu.
 * Oikeassa versiossa tilalle tulee Ilmatieteen laitoksen havainnot ja ennuste.
 */
export function generateCurrentWeather(
  config: Partial<GeneratorConfig> = {},
  years = CURRENT_WEATHER_YEARS,
): WeatherDay[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const history = simulateWeather(createRng(cfg.seed), cfg.startYear, cfg.endYear);
  const rng = createRng((cfg.seed ^ 0x5eed) >>> 0);
  return simulateWeather(rng, cfg.endYear + 1, cfg.endYear + years, history.state).weather;
}
