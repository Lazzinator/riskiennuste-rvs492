// Sovittaa mallit hakemiston public/data/ aineistoon ja kirjoittaa
//   model.json       hälytysmalli ja riskikartan malli (opetettu koko aineistolla)
//   validation.json  validointi: viimeinen vuosi testijoukkona, vertailu pelkkään keskiarvoon
// Lukee vain datatiedostot, joten sama skripti toimii myöhemmin oikealla datalla.
// Käyttö: npm run build-model

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset, type Dataset } from '../src/data/schema';
import { fitAlarmModel } from '../src/model/alarmModel';
import { buildDayContexts } from '../src/model/features';
import { fitSpatialModel } from '../src/model/spatialModel';
import { validateModel } from '../src/model/validation';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;

const ds: Dataset = {
  meta: read('meta.json'),
  grid: read('grid.json'),
  weather: read('weather.json'),
  incidents: read('incidents.json'),
};
const errors = validateDataset(ds);
if (errors.length > 0) {
  console.error(errors.slice(0, 20).join('\n'));
  process.exit(1);
}

// Pyöristys pitää tiedostot pieninä ja luettavina.
const round = (_key: string, v: unknown): unknown => (typeof v === 'number' ? Number(v.toPrecision(5)) : v);
const write = (name: string, data: unknown): void =>
  writeFileSync(join(dataDir, name), JSON.stringify(data, round) + '\n');

const alarm = fitAlarmModel(buildDayContexts(ds.weather), ds.incidents);
const spatial = fitSpatialModel(ds.grid, ds.incidents);
write('model.json', { source: ds.meta.source, alarm, spatial });

const report = validateModel(ds);
write('validation.json', report);

const pct = (x: number): string => `${(100 * x).toFixed(0)} %`;
console.log(`Opetus ${report.trainStart}...${report.trainEnd} (${report.trainIncidents} hälytystä), testi ${report.testStart}...${report.testEnd} (${report.testIncidents}).`);
console.log(
  `Päivädevianssi: malli ${report.dailyDeviance.model.toFixed(3)}, keskiarvo ${report.dailyDeviance.baseline.toFixed(3)} ` +
    `(parannus ${pct(1 - report.dailyDeviance.model / report.dailyDeviance.baseline)}).`,
);
console.log(
  `Kuukausimäärien virhe (MAE): malli ${report.monthlyMae.model.toFixed(2)}, keskiarvo ${report.monthlyMae.baseline.toFixed(2)}.`,
);
console.log(`Riskikartta: log-pistemäärä vs. tasajakauma ${report.spatialLogScoreVsUniform.toFixed(2)} (positiivinen = parempi).`);
