import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppData } from '../src/app/data';
import { buildTimingView, weeklyHeat } from '../src/app/timingView';
import { renderAbout } from '../src/app/views/about';
import { bannerText, simulationNote } from '../src/app/views/today';
import { TASK_TYPES, type DatasetMeta, type Grid, type Incident, type WeatherDay } from '../src/data/schema';
import type { AlarmModel } from '../src/model/alarmModel';
import { buildDayContexts } from '../src/model/features';
import type { SpatialModel } from '../src/model/spatialModel';
import type { ValidationReport } from '../src/model/validation';

const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, 'utf8')) as T;
const meta = read<DatasetMeta>('meta.json');
const { alarm, spatial } = read<{ alarm: AlarmModel; spatial: SpatialModel }>('model.json');
const incidents = read<Incident[]>('incidents.json');
const weather = read<WeatherDay[]>('weather.json');
const days = buildDayContexts(weather).filter((d) => d.date >= alarm.trainStart && d.date <= alarm.trainEnd);
const years = alarm.trainDays / 365.25;

describe('viikonpäivä x tunti', () => {
  it('summautuu vuoden odotettuun hälytysmäärään', () => {
    const heat = weeklyHeat(alarm, 'kaikki');
    const total = heat.flat().reduce((s, x) => s + x, 0);
    const perYear = TASK_TYPES.reduce((s, t) => s + alarm.types[t].trainCount, 0) / years;
    // model.json on pyöristetty viiteen merkitsevään numeroon.
    expect(total / perYear).toBeCloseTo(1, 4);
    expect(heat).toHaveLength(7);
    expect(heat.every((row) => row.length === 24)).toBe(true);
  });

  it('yöllä on hiljaista ja iltapäivällä tai illalla kiireisintä', () => {
    const v = buildTimingView(alarm, incidents, days, 'kaikki');
    expect(v.busiest.startHour).toBeGreaterThanOrEqual(12);
    expect(v.quietest.startHour).toBeLessThanOrEqual(4);
    expect(v.busiest.ratio).toBeGreaterThan(1.3);
    expect(v.quietest.ratio).toBeLessThan(0.6);
    expect(v.busiest.text).toMatch(/^klo \d+-\d+ \(/);
    const meanRatio = v.heat.flat().reduce((s, c) => s + c.ratio, 0) / (7 * 24);
    expect(meanRatio).toBeCloseTo(1, 10);
  });

  it('mainitsee vilkkaimman viikonpäivän vain, jos ero on selvä', () => {
    const flat = { ...alarm, types: { ...alarm.types } };
    for (const t of TASK_TYPES) flat.types[t] = { ...alarm.types[t], weekday: [1, 1, 1, 1, 1, 1, 1] };
    expect(buildTimingView(flat, incidents, days, 'kaikki').weekdayText).toMatch(/ei ole selvää eroa/);
    const friday = { ...alarm, types: { ...alarm.types } };
    for (const t of TASK_TYPES) friday.types[t] = { ...alarm.types[t], weekday: [1, 1, 1, 1, 1.6, 1, 1] };
    expect(buildTimingView(friday, incidents, days, 'kaikki').weekdayText).toMatch(/perjantai/);
  });
});

describe('kuukausijakauma', () => {
  it('toteutunut vastaa hälytyksiä ja malli on samaa tasoa', () => {
    const v = buildTimingView(alarm, incidents, days, 'kaikki');
    const actualTotal = v.months.actual.reduce((s, x) => s + x, 0) * years;
    expect(actualTotal).toBeCloseTo(incidents.length, 6);
    const modelTotal = v.months.model.reduce((s, x) => s + x, 0) * years;
    expect(modelTotal / incidents.length).toBeCloseTo(1, 2);
    expect(v.months.labels[2]).toBe('Maaliskuu');
    expect(v.months.labels[10]).toBe('Marraskuu');
  });

  it('maastopalojen huippu on keväällä ja talvella niitä ei juuri ole', () => {
    const v = buildTimingView(alarm, incidents, days, 'maastopalo');
    expect(['huhtikuu', 'toukokuu', 'kesäkuu']).toContain(v.months.busiest);
    expect(['joulukuu', 'tammikuu', 'helmikuu', 'maaliskuu']).toContain(v.months.quietest);
    expect(v.taskLabel).toBe('Maastopalo');
  });
});

describe('Tietoa-sivu', () => {
  const data: AppData = {
    meta,
    alarm,
    spatial,
    grid: read<Grid>('grid.json'),
    incidents,
    validation: read<ValidationReport>('validation.json'),
    weather,
  };

  it('kertoo simuloinnista, validoinnista ja oikean datan kytkemisestä', () => {
    const html = renderAbout(data);
    expect(html).toContain('Kaikki luvut perustuvat simuloituun dataan');
    expect(html).toContain('Kuinka hyvä malli on');
    expect(html).toContain(String(data.validation.testIncidents));
    expect(html).toContain('Miten oikea data kytketään');
    expect(html).toContain('nokipalo');
    expect(html).not.toContain('—');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toMatch(/-\d+ %/);
  });

  it('huomautukset vaihtuvat datan lähteen mukaan', () => {
    expect(bannerText(meta)).toContain('simuloituun dataan');
    expect(simulationNote(meta)).toContain('simuloituun dataan');
    const real: DatasetMeta = { ...meta, source: 'pronto', seed: null };
    expect(bannerText(real)).not.toContain('simuloi');
    expect(simulationNote(real)).not.toContain('simuloi');
    expect(simulationNote(real)).toContain('eivätkä virallisia');
  });
});
