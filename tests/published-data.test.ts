// Julkaistun datan (public/data) eheys ja tietosuoja. Ajetaan sekä simuloidulle että PRONTOsta
// tuodulle datalle ja sekä oikealla että ilman oikeaa säätä.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TASK_TYPES, validateDataset, type Dataset, type DatasetMeta, type Grid, type Incident, type WeatherDay } from '../src/data/schema';
import type { AlarmModel } from '../src/model/alarmModel';
import type { SpatialModel } from '../src/model/spatialModel';
import type { ValidationReport } from '../src/model/validation';

const dir = 'public/data';
const read = <T>(f: string): T => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as T;
const meta = read<DatasetMeta>('meta.json');
const incidents = read<Incident[]>('incidents.json');
const grid = read<Grid>('grid.json');
const model = read<{ source: string; alarm: AlarmModel; spatial: SpatialModel }>('model.json');
const validation = read<ValidationReport>('validation.json');
const history = read<WeatherDay[]>('weather.json');
const current = read<WeatherDay[]>('weather-current.json');

describe('julkaistu data', () => {
  it('on skeeman mukaista', () => {
    const ds: Dataset = { meta, grid, weather: history, incidents };
    expect(validateDataset(ds)).toEqual([]);
    expect(TASK_TYPES.every((t) => incidents.some((i) => i.taskType === t))).toBe(true);
  });

  it('malli on opetettu tällä aineistolla ja sään lähde täsmää', () => {
    expect(model.source).toBe(meta.source);
    expect(model.alarm.trainStart).toBe(meta.startDate);
    expect(model.alarm.trainEnd).toBe(meta.endDate);
    const trained = TASK_TYPES.reduce((s, t) => s + model.alarm.types[t].trainCount, 0);
    expect(trained).toBe(incidents.length);
    // Oikeaa hälytysdataa ei koskaan selitetä simuloidulla säällä.
    if (meta.source === 'pronto') expect(model.alarm.usesWeather).toBe(meta.weatherSource === 'fmi');
    expect(validation.usesWeather).toBe(model.alarm.usesWeather);
    expect(model.spatial.cellIds).toEqual(grid.cells.map((c) => c.id));
  });

  it('säädata kattaa aineiston jakson yhtenäisenä', () => {
    const weather = [...history, ...current.filter((w) => w.date > history.at(-1)!.date)];
    expect(weather[0]!.date <= meta.startDate).toBe(true);
    expect(weather.at(-1)!.date >= meta.endDate).toBe(true);
    for (let i = 1; i < weather.length; i++) {
      const gap = (Date.parse(weather[i]!.date) - Date.parse(weather[i - 1]!.date)) / 86_400_000;
      expect(gap).toBe(1);
    }
  });
});

describe('tietosuoja', () => {
  it('oikeassa datassa hälytyksillä ei ole sijaintia ja aika on tunnin tarkkuudella', () => {
    if (meta.source !== 'pronto') return;
    for (const i of incidents) {
      expect(Object.keys(i).sort()).toEqual(['cellId', 'id', 'taskType', 'time', 'urgency']);
      expect(i.cellId).toBeNull();
      expect(i.time).toMatch(/T\d{2}:00$/);
    }
  });

  it('julkaistuissa tiedostoissa ei ole osoitteita, koordinaattimerkintöjä tai henkilötietoja', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const text = readFileSync(`${dir}/${f}`, 'utf8');
      expect(text, f).not.toMatch(/°|osoite|address|kuollee|loukkaantu|henkilö/i);
      // Pisteiden koordinaatteja saa olla vain ruudukossa (ruutujen rajat) ja sääasemien tiedoissa.
      if (!['grid.json', 'weather-meta.json'].includes(f)) expect(text, f).not.toMatch(/"(lat|lon|latitude|longitude)"/);
    }
  });

  it('PRONTO-otetta ei ole repositoriossa', () => {
    const tracked = readdirSync('.').concat(existsSync('public') ? readdirSync('public') : []);
    expect(tracked.some((f) => /pronto.*\.(txt|csv)$/i.test(f))).toBe(false);
  });
});
