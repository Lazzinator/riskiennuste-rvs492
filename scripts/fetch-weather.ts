// Hakee säähavainnot ja -ennusteen Ilmatieteen laitoksen avoimesta datasta ja kirjoittaa
//   weather.json          havaintopäivät aineiston alusta eiliseen
//   weather-current.json  ennustepäivät tästä päivästä eteenpäin (forecast: true)
//   weather-meta.json     lähde, asemat ja hakuaika
// Käyttö: npm run fetch-weather
//
// Jos haku epäonnistuu, skripti päättyy virheeseen eikä muuta olemassa olevia tiedostoja.
// Julkaisutyönkulku jatkaa silloin ilman oikeaa säätä (malli opetetaan ilman sääselittäjiä).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayInHelsinki } from '../src/app/format';
import {
  dailyFromForecast,
  dailyFromObservations,
  FMI_POINT,
  fmiUrl,
  parseSimpleFeatures,
  stationsOf,
  STORED_QUERIES,
  type FmiValue,
} from '../src/data/fmi';
import { validateWeatherDay, type DatasetMeta } from '../src/data/schema';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const latlon = `${FMI_POINT.lat},${FMI_POINT.lon}`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let requests = 0;
/** Viimeisimmän vastauksen alku vianetsintää varten (ei sisällä mitään salaista). */
let lastResponseStart = '';

/**
 * Sijainnin ilmaisutavat kokeilujärjestyksessä. Kaikki kyselyt eivät tue kaikkia, joten
 * käytetään ensimmäistä, jolla saadaan arvoja. bbox: pituus, leveys, pituus, leveys.
 */
const LOCATIONS: Array<[string, Record<string, string | number>]> = [
  ['piste', { latlon, maxlocations: 4 }],
  ['alue', { bbox: '22.95,60.30,23.60,60.60' }],
  ['paikka Salo', { place: 'Salo', maxlocations: 4 }],
];

function summarize(values: readonly FmiValue[]): string {
  const filled = values.filter((v) => v.value !== null);
  const params = [...new Set(values.map((v) => v.param))].join(',');
  return `${values.length} arvoa, joista ${filled.length} ei-tyhjää; suureet ${params || '-'}; asemia ${stationsOf(values).length}`;
}

async function get(url: string): Promise<FmiValue[]> {
  for (let attempt = 1; ; attempt++) {
    requests++;
    await sleep(150); // kohtuullinen tahti avoimelle rajapinnalle
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'riskiennuste-rvs492 (Perttelin VPK, pilotti)' } });
      const text = await res.text();
      lastResponseStart = text.slice(0, 400).replace(/\s+/g, ' ');
      // Virheilmoitus tulee XML:nä myös HTTP-virhekoodilla; parseSimpleFeatures heittää sen viestin.
      const values = parseSimpleFeatures(text);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return values;
    } catch (err) {
      const msg = String(err);
      // Liian pitkä aikaväli tai virheellinen kysely: uudelleenyritys ei auta.
      if (/FMI:/.test(msg) || attempt >= 3) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Hakee aikavälin paloissa. Jos FMI hylkää liian pitkän välin, palan pituus puolitetaan. */
async function fetchChunked(
  storedQuery: string,
  params: Record<string, string | number>,
  start: string,
  end: string,
  chunkDays: number,
): Promise<FmiValue[]> {
  const out: FmiValue[] = [];
  let from = start;
  let size = chunkDays;
  while (from <= end) {
    const to = [addDays(from, size - 1), end].sort()[0]!;
    try {
      const url = fmiUrl(storedQuery, { ...params, starttime: `${from}T00:00:00Z`, endtime: `${to}T23:59:59Z` });
      out.push(...(await get(url)));
      from = addDays(to, 1);
    } catch (err) {
      if (size > 1 && /FMI:/.test(String(err))) {
        size = Math.max(1, Math.floor(size / 2));
        console.log(`  ${storedQuery}: aikaväli liian pitkä, kokeillaan ${size} päivää`);
        continue;
      }
      throw err;
    }
  }
  return out;
}

async function firstWorking<T>(label: string, attempts: Array<[string, () => Promise<T>]>): Promise<T> {
  const errors: string[] = [];
  for (const [name, run] of attempts) {
    try {
      const result = await run();
      console.log(`${label}: ${name}`);
      return result;
    } catch (err) {
      errors.push(`${name}: ${String(err)}`);
      console.log(`${label}: ${name} epäonnistui (${String(err).slice(0, 200)})`);
    }
  }
  throw new Error(`${label} ei onnistunut:\n${errors.join('\n')}`);
}

async function main(): Promise<void> {
  const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf8')) as DatasetMeta;
  const today = todayInHelsinki();
  const start = meta.startDate;
  const end = addDays(today, -1);
  console.log(`Haetaan havainnot ${start}...${end} pisteen ${latlon} lähimmiltä asemilta.`);

  // Kokeillaan lyhyellä jaksolla, mikä sijainnin ilmaisu toimii, ja haetaan sitten koko jakso.
  const probeStart = addDays(end, -6);
  async function fetchWithWorkingLocation(
    label: string,
    query: string,
    params: Record<string, string | number>,
    chunkDays: number,
  ): Promise<FmiValue[]> {
    return firstWorking(label, LOCATIONS.map(([name, loc]): [string, () => Promise<FmiValue[]>] => [
      name,
      async () => {
        const probe = await get(fmiUrl(query, { ...loc, ...params, starttime: `${probeStart}T00:00:00Z`, endtime: `${end}T23:59:59Z` }));
        console.log(`  ${label} / ${name}, koejakso: ${summarize(probe)}`);
        if (!probe.some((v) => v.value !== null)) throw new Error(`ei arvoja (vastauksen alku: ${lastResponseStart})`);
        const all = await fetchChunked(query, { ...loc, ...params }, start, end, chunkDays);
        console.log(`  ${label} / ${name}, koko jakso: ${summarize(all)}`);
        return all;
      },
    ]));
  }

  const daily = await fetchWithWorkingLocation(
    'Päivähavainnot',
    STORED_QUERIES.daily,
    { parameters: 'tday,tmin,tmax,rrday,snow' },
    365,
  );
  const wind = await firstWorking('Tuulihavainnot', [
    ['tuntiarvot', () => fetchWithWorkingLocation('Tuuli (tunti)', STORED_QUERIES.hourly, { parameters: 'WS_PT1H_AVG' }, 31)],
    [
      '10 min havainnot tunnin välein',
      () =>
        fetchWithWorkingLocation('Tuuli (10 min)', STORED_QUERIES.observations, { parameters: 'ws_10min', timestep: 60 }, 7),
    ],
  ]);
  const observations = dailyFromObservations(daily, wind, start, end);
  if (observations.length === 0) throw new Error(`havaintoja ei saatu (päiväarvot: ${summarize(daily)})`);

  const forecastParams = { parameters: 'Temperature,Precipitation1h,WindSpeedMS', timestep: 60 };
  const nonEmpty = async (run: Promise<FmiValue[]>): Promise<FmiValue[]> => {
    const values = await run;
    console.log(`  Ennuste: ${summarize(values)}`);
    if (!values.some((v) => v.value !== null)) throw new Error(`ei arvoja (vastauksen alku: ${lastResponseStart})`);
    return values;
  };
  const forecastHourly = await firstWorking('Ennuste', [
    ['FMI:n muokattu ennuste', () => nonEmpty(get(fmiUrl(STORED_QUERIES.forecast, { latlon, ...forecastParams })))],
    ['ECMWF-ennuste', () => nonEmpty(get(fmiUrl(STORED_QUERIES.forecastFallback, { latlon, ...forecastParams })))],
    ['FMI:n muokattu ennuste, paikka Salo', () => nonEmpty(get(fmiUrl(STORED_QUERIES.forecast, { place: 'Salo', ...forecastParams })))],
  ]);
  const forecast = dailyFromForecast(forecastHourly, observations[observations.length - 1]!);

  const errors = [...observations, ...forecast].flatMap(validateWeatherDay);
  if (errors.length) throw new Error(`virheellistä säädataa:\n${errors.slice(0, 10).join('\n')}`);
  if (observations[0]!.date > start) throw new Error(`havainnot alkavat vasta ${observations[0]!.date}`);

  const write = (name: string, data: unknown): void => writeFileSync(join(dataDir, name), JSON.stringify(data) + '\n');
  write('weather.json', observations);
  write('weather-current.json', forecast);
  write('weather-meta.json', {
    source: 'fmi',
    attribution: 'Ilmatieteen laitos, avoin data (CC BY 4.0)',
    point: FMI_POINT,
    stations: { daily: stationsOf(daily), wind: stationsOf(wind) },
    fetchedAt: new Date().toISOString(),
    observationsUntil: observations[observations.length - 1]!.date,
    forecastUntil: forecast[forecast.length - 1]?.date ?? null,
  });

  const missing = (p: string): number => daily.filter((v) => v.param === p && v.value === null).length;
  console.log(
    `Havaintopäiviä ${observations.length} (${observations[0]!.date}...${observations[observations.length - 1]!.date}), ennustepäiviä ${forecast.length}, kyselyjä ${requests}.`,
  );
  console.log(`Asemat (päiväarvot):`, stationsOf(daily));
  console.log(`Asemat (tuuli):`, stationsOf(wind));
  console.log(`Puuttuvia päiväarvoja: tday ${missing('tday')}, rrday ${missing('rrday')}, snow ${missing('snow')}.`);
  const years = new Set(observations.map((w) => w.date.slice(0, 4)));
  for (const y of years) {
    const ys = observations.filter((w) => w.date.startsWith(y));
    const t = ys.reduce((s, w) => s + w.tempMean, 0) / ys.length;
    const p = ys.reduce((s, w) => s + w.precipMm, 0);
    console.log(`  ${y}: ${ys.length} pv, keskilämpö ${t.toFixed(1)} °C, sade ${p.toFixed(0)} mm, lumipäiviä ${ys.filter((w) => w.snowDepthCm > 0).length}, liukkaita ${ys.filter((w) => w.slipperiness >= 2).length}`);
  }
}

main().catch((err) => {
  console.error(`Säähaku epäonnistui: ${String(err)}`);
  process.exit(1);
});
