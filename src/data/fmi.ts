// Ilmatieteen laitoksen avoin data (https://opendata.fmi.fi, lisenssi CC BY 4.0).
// Puhtaat funktiot: kyselyjen osoitteet, WFS-vastausten (simple-muoto) jäsennys ja koonti
// sovelluksen päiväsääksi. Verkkohaut tehdään skriptissä scripts/fetch-weather.ts.

import type { WeatherDay } from './schema';
import { deriveSlipperiness, stepSnowDepth } from './weather';

export const FMI_WFS = 'https://opendata.fmi.fi/wfs';

/** Toiminta-alueen keskipiste (Kaivolan ja Inkereen välissä). Asemat haetaan tämän läheltä. */
export const FMI_POINT = { lat: 60.44, lon: 23.26 };

export const STORED_QUERIES = {
  /** Päiväarvot: keskilämpötila, ali- ja ylilämpötila, sademäärä, lumensyvyys */
  daily: 'fmi::observations::weather::daily::simple',
  /** Tuntiarvot tuulen keskinopeudelle */
  hourly: 'fmi::observations::weather::hourly::simple',
  /** Varalla: 10 minuutin havainnot tunnin välein */
  observations: 'fmi::observations::weather::simple',
  /** Meteorologin muokkaama pistekohtainen ennuste noin 10 vuorokaudeksi */
  forecast: 'fmi::forecast::edited::weather::scandinavia::point::simple',
  /** Varalla: ECMWF-mallin pisteennuste */
  forecastFallback: 'ecmwf::forecast::surface::point::simple',
} as const;

export function fmiUrl(storedQuery: string, params: Record<string, string | number>): string {
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'getFeature',
    storedquery_id: storedQuery,
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return `${FMI_WFS}?${q.toString()}`;
}

export interface FmiValue {
  lat: number;
  lon: number;
  /** UTC-aikaleima ISO-muodossa */
  time: string;
  param: string;
  /** null = puuttuva arvo (NaN) */
  value: number | null;
}

/** Jäsentää simple-muotoisen WFS-vastauksen. Heittää virheen, jos vastaus on virheilmoitus. */
export function parseSimpleFeatures(xml: string): FmiValue[] {
  const exception = /<ExceptionText>([\s\S]*?)<\/ExceptionText>/.exec(xml);
  if (exception) throw new Error(`FMI: ${exception[1]!.trim()}`);
  const out: FmiValue[] = [];
  const element = /<BsWfs:BsWfsElement[^>]*>([\s\S]*?)<\/BsWfs:BsWfsElement>/g;
  const tag = (body: string, name: string): string | undefined =>
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim();
  for (let m = element.exec(xml); m; m = element.exec(xml)) {
    const body = m[1]!;
    const pos = tag(body, 'gml:pos')?.split(/\s+/).map(Number);
    const time = tag(body, 'BsWfs:Time');
    const param = tag(body, 'BsWfs:ParameterName');
    const raw = tag(body, 'BsWfs:ParameterValue');
    if (!pos || pos.length < 2 || !time || !param) continue;
    const value = raw === undefined || raw === '' || raw === 'NaN' ? null : Number(raw);
    out.push({ lat: pos[0]!, lon: pos[1]!, time, param, value: Number.isFinite(value) ? value : null });
  }
  return out;
}

/** UTC-aikaleiman päivämäärä Suomen ajassa. */
export function helsinkiDate(utcIso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcIso));
}

const round1 = (x: number): number => Math.round(x * 10) / 10 || 0;

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dy = (a.lat - b.lat) * 111.32;
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * Valitsee jokaiselle (päivä, suure) -parille arvon lähimmältä asemalta, jolla arvo on.
 * Eri suureet voivat siis tulla eri asemilta (esim. lumensyvyyttä mitataan harvemmilla asemilla).
 */
function nearestByDateAndParam(
  values: readonly FmiValue[],
  center: { lat: number; lon: number },
  dateOf: (v: FmiValue) => string,
): Map<string, Map<string, number[]>> {
  // päivä -> suure -> [arvo, etäisyys] parhaana; tunneittaisille arvoille kerätään kaikki lähimmältä asemalta
  const byStation = new Map<string, number>();
  for (const v of values) {
    const key = `${v.lat},${v.lon}`;
    if (!byStation.has(key)) byStation.set(key, distanceKm(v, center));
  }
  const best = new Map<string, Map<string, { dist: number; values: number[] }>>();
  for (const v of values) {
    if (v.value === null) continue;
    const date = dateOf(v);
    const dist = byStation.get(`${v.lat},${v.lon}`)!;
    if (!best.has(date)) best.set(date, new Map());
    const byParam = best.get(date)!;
    const cur = byParam.get(v.param);
    if (!cur || dist < cur.dist) byParam.set(v.param, { dist, values: [v.value] });
    else if (dist === cur.dist) cur.values.push(v.value);
  }
  const out = new Map<string, Map<string, number[]>>();
  for (const [date, byParam] of best) out.set(date, new Map([...byParam].map(([p, x]) => [p, x.values])));
  return out;
}

export interface StationInfo {
  lat: number;
  lon: number;
  distanceKm: number;
}

export function stationsOf(values: readonly FmiValue[], center = FMI_POINT): StationInfo[] {
  const seen = new Map<string, StationInfo>();
  for (const v of values) {
    const key = `${v.lat},${v.lon}`;
    if (!seen.has(key)) seen.set(key, { lat: v.lat, lon: v.lon, distanceKm: round1(distanceKm(v, center)) });
  }
  return [...seen.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}

function* dateRange(start: string, end: string): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Havaintopäivät: päiväarvot (tday, tmin, tmax, rrday, snow) ja tuntituulet päivän keskiarvoksi.
 * Puuttuvat arvot täydennetään edellisestä päivästä, jotta jono on yhtenäinen (kuivuus- ja
 * kylmenemislaskenta tarvitsevat peräkkäiset päivät). FMI:n arvo -1 sademäärässä ja
 * lumensyvyydessä tarkoittaa "ei sadetta" tai "ei lunta".
 */
export function dailyFromObservations(
  daily: readonly FmiValue[],
  wind: readonly FmiValue[],
  start: string,
  end: string,
  center = FMI_POINT,
): WeatherDay[] {
  const d = nearestByDateAndParam(daily, center, (v) => v.time.slice(0, 10));
  const w = nearestByDateAndParam(wind, center, (v) => helsinkiDate(v.time));
  const out: WeatherDay[] = [];
  let prev: WeatherDay | null = null;
  for (const date of dateRange(start, end)) {
    const p = d.get(date);
    const get = (name: string): number | undefined => p?.get(name)?.[0];
    let tMin = get('tmin');
    let tMax = get('tmax');
    let tMean = get('tday') ?? (tMin !== undefined && tMax !== undefined ? (tMin + tMax) / 2 : undefined);
    if (tMean === undefined) {
      if (!prev) continue; // jakson alusta puuttuvat päivät jätetään pois
      tMean = prev.tempMean;
    }
    tMin = Math.min(tMin ?? tMean - 3, tMean);
    tMax = Math.max(tMax ?? tMean + 3, tMean);
    const precip = Math.max(0, get('rrday') ?? 0);
    const snowObs = get('snow');
    const snow =
      snowObs !== undefined ? Math.max(0, snowObs) : stepSnowDepth(prev?.snowDepthCm ?? 0, tMean, tMax, precip);
    const hourly = w.get(date);
    const windValues = hourly?.get('WS_PT1H_AVG') ?? hourly?.get('ws_10min') ?? [];
    const windMs = windValues.length >= 12 ? mean(windValues) : (prev?.windMs ?? 3.5);
    const day: WeatherDay = {
      date,
      tempMean: round1(tMean),
      tempMin: round1(tMin),
      tempMax: round1(tMax),
      precipMm: round1(precip),
      snowDepthCm: Math.round(snow),
      windMs: round1(windMs),
      slipperiness: deriveSlipperiness({ tempMean: tMean, tempMin: tMin, tempMax: tMax, precipMm: precip }, snow, prev),
    };
    out.push(day);
    prev = day;
  }
  return out;
}

/**
 * Ennustepäivät tuntiennusteesta (Temperature, Precipitation1h, WindSpeedMS). Lumensyvyys
 * jatketaan viimeisestä havainnosta sulamismallilla. Päivä otetaan mukaan, jos sille on
 * vähintään 12 tuntiarvoa; ensimmäiselle päivälle (tänään) riittää 4.
 */
export function dailyFromForecast(hourly: readonly FmiValue[], lastObservation: WeatherDay | null): WeatherDay[] {
  const byDate = new Map<string, { t: number[]; p: number[]; w: number[] }>();
  for (const v of hourly) {
    if (v.value === null) continue;
    const date = helsinkiDate(v.time);
    if (lastObservation && date <= lastObservation.date) continue;
    if (!byDate.has(date)) byDate.set(date, { t: [], p: [], w: [] });
    const g = byDate.get(date)!;
    if (v.param === 'Temperature') g.t.push(v.value);
    else if (v.param === 'Precipitation1h') g.p.push(Math.max(0, v.value));
    else if (v.param === 'WindSpeedMS') g.w.push(v.value);
  }
  const out: WeatherDay[] = [];
  let prev: WeatherDay | null = lastObservation;
  [...byDate.keys()].sort().forEach((date, i) => {
    const g = byDate.get(date)!;
    if (g.t.length < (i === 0 ? 4 : 12)) return;
    const tMean = mean(g.t);
    const tMin = Math.min(...g.t);
    const tMax = Math.max(...g.t);
    const precip = g.p.reduce((s, x) => s + x, 0);
    const snow = stepSnowDepth(prev?.snowDepthCm ?? 0, tMean, tMax, precip);
    const day: WeatherDay = {
      date,
      tempMean: round1(tMean),
      tempMin: round1(tMin),
      tempMax: round1(tMax),
      precipMm: round1(precip),
      snowDepthCm: Math.round(snow),
      windMs: round1(g.w.length ? mean(g.w) : (prev?.windMs ?? 3.5)),
      slipperiness: deriveSlipperiness({ tempMean: tMean, tempMin: tMin, tempMax: tMax, precipMm: precip }, snow, prev),
      forecast: true,
    };
    out.push(day);
    prev = day;
  });
  return out;
}
