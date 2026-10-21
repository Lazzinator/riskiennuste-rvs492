// Tuo PRONTO-otteen ja kirjoittaa julkaistavat tiedostot hakemistoon public/data/.
// Käyttö: npm run import-pronto -- <polku/Pronto_492.txt>
//
// Tietosuoja: ote sisältää osoitteita, koordinaatteja ja henkilömääriä. Ote itse ei kuulu
// repositorioon. Tästä kirjoitetaan vain
//   incidents.json  hälytysaika tunnin tarkkuudella, tehtävätyyppi ja kiireellisyys, EI sijaintia
//   spatial.json    riskikartan tasoitettu tiheys ruuduittain (ytimen säde 1,5 km), ei pisteitä
//   grid.json       1 km ruudukko toiminta-alueelle
//   meta.json       aineiston kuvaus
// Sijainnit käsitellään vain muistissa tämän skriptin ajon ajan.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGridForBounds } from '../src/data/geo';
import { boundsFromRecords, dedupe, parseProntoText, toIncidents } from '../src/data/pronto';
import { SCHEMA_VERSION, TASK_TYPES, TASK_TYPE_LABELS, type DatasetMeta, type WeatherSource } from '../src/data/schema';
import { fitSpatialModel } from '../src/model/spatialModel';
import { spatialValidation, testStartFor } from '../src/model/validation';

const file = process.argv[2];
if (!file) {
  console.error('Käyttö: npm run import-pronto -- <PRONTO-ote.txt>');
  process.exit(1);
}

// PRONTOn ote on yleensä Windows-1252-merkistössä; UTF-8 kelpaa myös.
const buf = readFileSync(file);
let text: string;
try {
  text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
} catch {
  text = new TextDecoder('windows-1252').decode(buf);
}

const parsed = parseProntoText(text);
const records = dedupe(parsed.records);
const grid = buildGridForBounds(boundsFromRecords(records), 1000);
const incidents = toIncidents(records, grid);

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const round = (_key: string, v: unknown): unknown => (typeof v === 'number' ? Number(v.toPrecision(4)) : v);
const write = (name: string, data: unknown, replacer?: (k: string, v: unknown) => unknown): void =>
  writeFileSync(join(dataDir, name), JSON.stringify(data, replacer) + '\n');

// Riskikartta ja sen validointi lasketaan tässä, koska vain tässä sijainnit ovat käytettävissä.
const firstDate = `${incidents[0]!.time.slice(0, 4)}-01-01`;
const lastDate = incidents[incidents.length - 1]!.time.slice(0, 10);
const testStart = testStartFor(lastDate);
const spatial = fitSpatialModel(grid, incidents);
const validationScore = spatialValidation(grid, incidents, testStart);
write('spatial.json', { ...spatial, validationScore, testStart }, round);
write('grid.json', grid);
// Julkaistaan ilman sijaintia.
write(
  'incidents.json',
  incidents.map((i) => ({ ...i, cellId: null })),
);

let weatherSource: WeatherSource = 'simulated';
const weatherMetaPath = join(dataDir, 'weather-meta.json');
if (existsSync(weatherMetaPath)) weatherSource = JSON.parse(readFileSync(weatherMetaPath, 'utf8')).source;
const meta: DatasetMeta = {
  source: 'pronto',
  weatherSource,
  seed: null,
  startDate: firstDate,
  endDate: lastDate,
  incidentCount: incidents.length,
  schemaVersion: SCHEMA_VERSION,
  note: 'RVS492:n hälytykset PRONTOsta. Julkaistu ilman sijainteja; riskikartta on tasoitettu tiheys.',
};
write('meta.json', meta);

// Yhteenveto ilman arkaluonteisia tietoja.
const located = incidents.filter((i) => i.cellId !== null).length;
console.log(`Rivejä ${parsed.records.length}, yhdistettyjä kaksoiskirjauksia ${parsed.records.length - records.length}, hälytyksiä ${incidents.length} (${firstDate}...${lastDate}).`);
console.log(`Sijainti ruudukossa: ${located}, ruudukon ulkopuolella tai ilman sijaintia: ${incidents.length - located}. Ruutuja ${grid.cells.length}.`);
for (const t of TASK_TYPES) {
  console.log(`  ${TASK_TYPE_LABELS[t].padEnd(28)} ${incidents.filter((i) => i.taskType === t).length}`);
}
if (Object.keys(parsed.unknownTypes).length) console.log('Tuntemattomat onnettomuustyypit (luokiteltu muu):', parsed.unknownTypes);
if (parsed.missingUrgency) console.log(`Kiireellisyys puuttui ${parsed.missingUrgency} riviltä (oletettu C).`);
if (parsed.badTime) console.log(`Hälytysaikaa ei voitu tulkita ${parsed.badTime} riviltä (ohitettu).`);
console.log(`Riskikartan validointi (testi alkaen ${testStart}): ${validationScore?.toFixed(2) ?? '-'} (positiivinen = parempi kuin tasajakauma).`);
