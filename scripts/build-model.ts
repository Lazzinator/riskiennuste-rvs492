// Sovittaa mallit hakemiston public/data/ aineistoon ja kirjoittaa
//   model.json       hälytysmalli ja riskikartan malli (opetettu koko aineistolla)
//   validation.json  validointi: viimeiset 12 kk testijoukkona, vertailu pelkkään keskiarvoon
// Lukee vain datatiedostot, joten toimii sekä simuloidulla että PRONTOsta tuodulla datalla.
// Käyttö: npm run build-model
//
// Sää: jos weather-meta.json kertoo säädatan tulevan Ilmatieteen laitokselta (fmi), malli
// käyttää sääselittäjiä. Muuten malli sovitetaan ilman säätä, jottei oikeita hälytyksiä
// selitetä simuloidulla säällä.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset, type Dataset, type DatasetMeta, type WeatherDay, type WeatherSource } from '../src/data/schema';
import { fitAlarmModel } from '../src/model/alarmModel';
import { buildDayContexts } from '../src/model/features';
import { fitSpatialModel, type SpatialModel } from '../src/model/spatialModel';
import { validateModel } from '../src/model/validation';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const path = (name: string): string => join(dataDir, name);
const read = <T>(name: string): T => JSON.parse(readFileSync(path(name), 'utf8')) as T;

const weatherSource: WeatherSource = existsSync(path('weather-meta.json'))
  ? read<{ source: WeatherSource }>('weather-meta.json').source
  : 'simulated';
const meta: DatasetMeta = { ...read<DatasetMeta>('meta.json'), weatherSource };

// Havainnot ja nykysää yhtenä jonona; ennustepäiviä ei käytetä opetukseen.
const history = read<WeatherDay[]>('weather.json');
const current = existsSync(path('weather-current.json')) ? read<WeatherDay[]>('weather-current.json') : [];
const lastHistory = history[history.length - 1]!.date;
const weather = [...history, ...current.filter((w) => w.date > lastHistory && !w.forecast)];

const ds: Dataset = { meta, grid: read('grid.json'), weather, incidents: read('incidents.json') };
const errors = validateDataset(ds);
if (errors.length > 0) {
  console.error(errors.slice(0, 20).join('\n'));
  process.exit(1);
}
if (weather[0]!.date > meta.startDate || weather[weather.length - 1]!.date < meta.endDate) {
  console.error(`Säädata ei kata hälytysaineiston jaksoa ${meta.startDate}...${meta.endDate}.`);
  process.exit(1);
}

// Riskikartta: simuloidussa datassa sijainnit ovat mukana, PRONTO-datasta käytetään tuonnissa
// laskettua tasoitettua tiheyttä (spatial.json).
const located = ds.incidents.some((i) => i.cellId !== null);
const spatialFile = located ? null : read<SpatialModel & { validationScore: number | null }>('spatial.json');
const spatial: SpatialModel = spatialFile
  ? { cellIds: spatialFile.cellIds, bandwidthM: spatialFile.bandwidthM, shares: spatialFile.shares, pooled: spatialFile.pooled }
  : fitSpatialModel(ds.grid, ds.incidents);

const useWeather = weatherSource === 'fmi' || meta.source === 'simulated';
const days = buildDayContexts(weather).filter((d) => d.date >= meta.startDate && d.date <= meta.endDate);
const alarm = fitAlarmModel(days, ds.incidents, { useWeather });

// Pyöristys pitää tiedostot pieninä ja luettavina.
const round = (_key: string, v: unknown): unknown => (typeof v === 'number' ? Number(v.toPrecision(5)) : v);
const write = (name: string, data: unknown): void => writeFileSync(path(name), JSON.stringify(data, round) + '\n');

write('model.json', { source: meta.source, alarm, spatial });
const report = validateModel(ds, { useWeather });
if (report.spatialLogScoreVsUniform === null && spatialFile) report.spatialLogScoreVsUniform = spatialFile.validationScore;
write('validation.json', report);
write('meta.json', meta);

const pct = (x: number): string => `${(100 * x).toFixed(0)} %`;
console.log(`Data: ${meta.source}, sää: ${weatherSource}, sääselittäjät ${useWeather ? 'käytössä' : 'pois käytöstä'}.`);
console.log(
  `Opetus ${report.trainStart}...${report.trainEnd} (${report.trainIncidents} hälytystä), testi ${report.testStart}...${report.testEnd} (${report.testIncidents}).`,
);
console.log(
  `Päivädevianssi: malli ${report.dailyDeviance.model.toFixed(3)}, keskiarvo ${report.dailyDeviance.baseline.toFixed(3)} ` +
    `(parannus ${pct(1 - report.dailyDeviance.model / report.dailyDeviance.baseline)}).`,
);
console.log(`Kuukausimäärien virhe (MAE): malli ${report.monthlyMae.model.toFixed(2)}, keskiarvo ${report.monthlyMae.baseline.toFixed(2)}.`);
console.log(`Riskikartta: log-pistemäärä vs. tasajakauma ${report.spatialLogScoreVsUniform?.toFixed(2) ?? '-'} (positiivinen = parempi).`);
