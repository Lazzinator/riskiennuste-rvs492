import { describe, expect, it } from 'vitest';
import { buildGridForBounds } from '../src/data/geo';
import {
  boundsFromRecords,
  cellOf,
  dedupe,
  parseDegreesMinutes,
  parseProntoText,
  parseProntoTime,
  PRONTO_TYPE_MAP,
  toIncidents,
} from '../src/data/pronto';
import { TASK_TYPES } from '../src/data/schema';

// Keksitty ote PRONTOn sarakemuodossa. Osoitteet ja paikat ovat fiktiivisiä.
const HEADER = [
  'Vuosi',
  'Kohteen osoite',
  "Pohjoiskoord. (Naa°mm.mmm')",
  "Itäkoord. (Eaaa°mm.mmm')",
  'Onnettomuustyyppi 1',
  'Onnettomuudessa kuolleet (lkm)',
  'Tehtävän resurssiluokitus',
  'Hälytetty',
].join('#');
const row = (time: string, type: string, urgency: string, lat = "N60°26.400'", lon = "E23°15.000'"): string =>
  ['2024', 'Keksitty katu 1', lat, lon, type, '0', urgency, time].join('#');

const SAMPLE = [
  HEADER,
  row('19.5.2024 15:54:29', 'Rakennuspalo', 'B-kiireellisyys'),
  row('19.5.2024 15:54:29', 'Rakennuspalo', 'D-kiireellisyys'), // kaksoiskirjaus
  row('1.6.2024 8:05:00', 'Rakennuspalovaara', 'C-kiireellisyys'),
  row('2.6.2024 23:59:59', 'Liikennevälinepalo', 'B-kiireellisyys', "N60°30.000'", "E23°20.000'"),
  row('3.6.2024 12:00:00', 'Öljyvahinko', '', '99999', '99999'),
  row('4.6.2024 12:00:00', 'Uusi tuntematon tyyppi', 'A-kiireellisyys'),
  row('ei aikaa', 'Maastopalo', 'B-kiireellisyys'),
].join('\r\n');

describe('PRONTO-jäsennys', () => {
  it('tulkitsee koordinaatit ja ajat', () => {
    expect(parseDegreesMinutes("N60°26.400'")).toBeCloseTo(60.44, 6);
    expect(parseDegreesMinutes("E23°15,6'")).toBeCloseTo(23.26, 6);
    expect(parseDegreesMinutes('99999')).toBeNull();
    expect(parseDegreesMinutes("N60°75.0'")).toBeNull();
    expect(parseProntoTime('19.5.2024 15:54:29')).toBe('2024-05-19T15:54:29');
    expect(parseProntoTime('1.12.2023 7:05')).toBe('2023-12-01T07:05:00');
    expect(parseProntoTime('31.13.2023 7:05')).toBeNull();
  });

  it('lukee vain tarvittavat sarakkeet ja raportoi poikkeamat', () => {
    const r = parseProntoText(SAMPLE);
    expect(r.records).toHaveLength(6);
    expect(r.badTime).toBe(1);
    expect(r.missingUrgency).toBe(1);
    expect(r.unknownTypes).toEqual({ 'Uusi tuntematon tyyppi': 1 });
    expect(r.records.map((x) => x.taskType)).toEqual([
      'rakennuspalo',
      'rakennuspalo',
      'rakennuspalo',
      'muu_tulipalo',
      'vahingontorjunta',
      'muu',
    ]);
    // Osoitetta tai henkilömääriä ei kopioida tietueisiin.
    expect(JSON.stringify(r.records)).not.toContain('Keksitty katu');
    expect(Object.keys(r.records[0]!).sort()).toEqual(['alarmTime', 'lat', 'lon', 'prontoType', 'taskType', 'urgency']);
  });

  it('puuttuva sarake on virhe', () => {
    expect(() => parseProntoText('Vuosi#Hälytetty\n2024#1.1.2024 10:00:00')).toThrow(/sarake puuttuu/);
  });

  it('yhdistää kaksoiskirjaukset ja säilyttää kiireellisimmän luokan', () => {
    const r = dedupe(parseProntoText(SAMPLE).records);
    expect(r).toHaveLength(5);
    expect(r[0]!.urgency).toBe('B');
  });

  it('kaikki tunnetut PRONTO-tyypit kuuluvat sovelluksen tyyppeihin', () => {
    for (const t of Object.values(PRONTO_TYPE_MAP)) expect(TASK_TYPES).toContain(t);
    expect(PRONTO_TYPE_MAP['Rakennuspalovaara']).toBe('rakennuspalo');
  });

  it('muuntaa hälytyksiksi tunnin tarkkuudella ja ruutuun', () => {
    const records = dedupe(parseProntoText(SAMPLE).records);
    const grid = buildGridForBounds(boundsFromRecords(records, 2000), 1000);
    const incidents = toIncidents(records, grid);
    expect(incidents[0]).toMatchObject({ id: 'P-2024-0001', time: '2024-05-19T15:00', taskType: 'rakennuspalo', urgency: 'B' });
    expect(incidents.every((i) => i.time.endsWith(':00'))).toBe(true);
    expect(incidents[0]!.cellId).not.toBeNull();
    // Ilman koordinaatteja oleva hälytys on mukana ilman ruutua.
    expect(incidents.find((i) => i.taskType === 'vahingontorjunta')!.cellId).toBeNull();
    expect(cellOf(grid, 10, 10)).toBeNull();
  });

  it('ruudukko rajataan datan keskeiselle alueelle', () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      alarmTime: `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}`,
      prontoType: 'Rakennuspalo',
      taskType: 'rakennuspalo' as const,
      urgency: 'B' as const,
      lat: 60.4 + (i % 10) * 0.01,
      lon: 23.2 + Math.floor(i / 10) * 0.01,
    }));
    records.push({ ...records[0]!, lat: 61.5, lon: 25 }); // kaukainen poikkeama
    const b = boundsFromRecords(records, 1000);
    expect(b.north).toBeLessThan(60.6);
    expect(b.east).toBeLessThan(23.4);
    expect(b.south).toBeLessThan(60.4);
  });
});
