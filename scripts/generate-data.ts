// Tuottaa simuloidun datan hakemistoon data-sim/ (ei versionhallinnassa). Sovellus käyttää
// PRONTOsta tuotua dataa (public/data/); simulaattoria käytetään testeissä ja mallin
// tarkistamisessa. Simuloidun version saa sovellukseen kopioimalla data-sim/ -> public/data/.
// Käyttö: npm run generate-data [-- --seed 492]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, generateCurrentWeather, generateDataset } from '../src/data/generator';
import { TASK_TYPES, validateDataset, validateWeatherDay } from '../src/data/schema';

const seedArg = process.argv.indexOf('--seed');
const seed = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : DEFAULT_CONFIG.seed;
if (!Number.isInteger(seed)) throw new Error('--seed vaatii kokonaisluvun');

const ds = generateDataset({ seed });
const current = generateCurrentWeather({ seed });
const errors = [...validateDataset(ds), ...current.flatMap(validateWeatherDay)];
if (errors.length > 0) {
  console.error(errors.slice(0, 20).join('\n'));
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data-sim');
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown): void =>
  writeFileSync(join(outDir, name), JSON.stringify(data) + '\n');
write('meta.json', ds.meta);
write('grid.json', ds.grid);
write('weather.json', ds.weather);
write('incidents.json', ds.incidents);
// Pilotin "nykysää" historian jälkeen. Oikeassa versiossa Ilmatieteen laitoksen havainnot ja ennuste.
write('weather-current.json', current);

const years = Number(ds.meta.endDate.slice(0, 4)) - Number(ds.meta.startDate.slice(0, 4)) + 1;
console.log(`Siemen ${seed}: ${ds.incidents.length} hälytystä ${years} vuodessa, ${ds.grid.cells.length} ruutua.`);
console.log(`Nykysää: ${current[0]!.date}...${current[current.length - 1]!.date}.`);
for (const t of TASK_TYPES) {
  console.log(`  ${t.padEnd(28)} ${ds.incidents.filter((i) => i.taskType === t).length}`);
}
