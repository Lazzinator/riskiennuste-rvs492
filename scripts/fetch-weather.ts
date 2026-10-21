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

async function get(url: string): Promise<FmiValue[]> {
  for (let attempt = 1; ; attempt++) {
    requests++;
    await sleep(150); // kohtuullinen tahti avoimelle rajapinnalle
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'riskiennuste-rvs492 (Perttelin VPK, pilotti)' } });
      const text = await res.text();
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

  const daily = await fetchChunked(
    STORED_QUERIES.daily,
    { latlon, maxlocations: 4, parameters: 'tday,tmin,tmax,rrday,snow' },
    start,
    end,
    365,
  );
  const wind = await firstWorking('Tuulihavainnot', [
    [
      'tuntiarvot',
      () => fetchChunked(STORED_QUERIES.hourly, { latlon, maxlocations: 2, parameters: 'WS_PT1H_AVG' }, start, end, 31),
    ],
    [
      '10 min havainnot tunnin välein',
      () =>
        fetchChunked(
          STORED_QUERIES.observations,
          { latlon, maxlocations: 2, parameters: 'ws_10min', timestep: 60 },
          start,
          end,
          7,
        ),
    ],
  ]);
  const observations = dailyFromObservations(daily, wind, start, end);
  if (observations.length === 0) throw new Error('havaintoja ei saatu');

  const forecastParams = { latlon, parameters: 'Temperature,Precipitation1h,WindSpeedMS', timestep: 60 };
  const forecastHourly = await firstWorking('Ennuste', [
    ['FMI:n muokattu ennuste', () => get(fmiUrl(STORED_QUERIES.forecast, forecastParams))],
    ['ECMWF-ennuste', () => get(fmiUrl(STORED_QUERIES.forecastFallback, forecastParams))],
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
