import { describe, expect, it } from 'vitest';
import type { AppData } from '../src/app/data';
import { buildTimingView, weeklyHeat } from '../src/app/timingView';
import { busyMonths, renderAbout, weatherUseText } from '../src/app/views/about';
import { bannerText, simulationNote } from '../src/app/views/today';
import { TASK_TYPES, type DatasetMeta } from '../src/data/schema';
import { buildDayContexts } from '../src/model/features';
import { simulated } from './fixtures';

const { meta, alarm, incidents, weather } = simulated;
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

  it('yöllä on hiljaista ja päivällä tai illalla kiireisintä', () => {
    const v = buildTimingView(alarm, incidents, days, 'kaikki');
    expect(v.busiest.startHour).toBeGreaterThanOrEqual(8);
    expect(v.busiest.endHour).toBeLessThanOrEqual(22);
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
  it('simuloidulla datalla kertoo simuloinnista ja validoinnista', () => {
    const html = renderAbout(simulated);
    expect(html).toContain('Kaikki luvut perustuvat simuloituun dataan');
    expect(html).toContain('Kuinka hyvä malli on');
    expect(html).toContain(String(simulated.validation.testIncidents));
    expect(html).toContain('Maastopaloriski 1-5');
    expect(html).not.toContain('—');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toMatch(/-\d+ %/);
  });

  it('oikealla datalla ilman säätä kertoo datan, tietosuojan ja sään tilan', () => {
    const real: AppData = { ...simulated, meta: { ...meta, source: 'pronto', weatherSource: 'simulated', seed: null } };
    const html = renderAbout(real);
    expect(html).not.toContain('simuloituun dataan');
    expect(html).toContain('PRONTO');
    expect(html).toContain('Tietosuoja');
    expect(html).toContain('Ei vielä käytössä');
    // Maastopaloindeksiä ei esitetä ilman oikeaa säätä.
    expect(html).not.toContain('Maastopaloriski 1-5');
    expect(html).not.toMatch(/-\d+ %/);
    const withWeather = renderAbout({ ...real, meta: { ...real.meta, weatherSource: 'fmi' } });
    expect(withWeather).toContain('Ilmatieteen laitoksen avoimesta datasta');
    expect(withWeather).toContain('Maastopaloriski 1-5');
  });

  it('kertoo, mihin tyyppeihin sää vaikuttaa', () => {
    const text = weatherUseText(alarm);
    expect(text).toMatch(/maastopalo \(lumipeite, kuivuus/);
    const none = { ...alarm, types: Object.fromEntries(TASK_TYPES.map((t) => [t, { ...alarm.types[t], features: {} }])) } as typeof alarm;
    expect(weatherUseText(none)).toContain('ei käytä niitä');
  });

  it('nimeää kausihuiput kuukausikertoimista', () => {
    const fake = { ...alarm, types: { ...alarm.types } };
    const months = (f: number[]) => ({ ...alarm.types.rakennuspalo, month: f });
    fake.types.rakennuspalo = months([1, 1, 1, 1, 1, 1, 1, 1.3, 1.4, 1, 1, 1]);
    expect(busyMonths(fake, 'rakennuspalo')).toBe('elo-syyskuu');
    fake.types.rakennuspalo = months([1.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5]);
    expect(busyMonths(fake, 'rakennuspalo')).toBe('joulu-tammikuu');
    fake.types.rakennuspalo = months([1, 1, 1, 1, 1.25, 1, 1, 1, 1, 1, 1, 1]);
    expect(busyMonths(fake, 'rakennuspalo')).toBe('toukokuu');
    fake.types.rakennuspalo = months(new Array(12).fill(1));
    expect(busyMonths(fake, 'rakennuspalo')).toBe('ei selvää kausivaihtelua');
  });

  it('huomautukset vaihtuvat datan ja sään lähteen mukaan', () => {
    expect(bannerText(meta)).toContain('simuloituun dataan');
    expect(simulationNote(meta)).toContain('simuloituun dataan');
    const real: DatasetMeta = { ...meta, source: 'pronto', seed: null, weatherSource: 'simulated' };
    expect(bannerText(real)).not.toContain('simuloi');
    expect(simulationNote(real)).not.toContain('simuloi');
    expect(simulationNote(real)).toContain('PRONTO');
    expect(simulationNote(real)).toContain('Säätietoja ei ole käytössä');
    expect(simulationNote({ ...real, weatherSource: 'fmi' })).toContain('Ilmatieteen laitos');
  });
});
