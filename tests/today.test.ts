import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { requestedDate } from '../src/app/data';
import { fmtDate, fmtEffect, fmtNum, fmtPercent, fmtRatio, todayInHelsinki } from '../src/app/format';
import { parseRoute } from '../src/app/router';
import { buildTodayView, resolveDate, weatherSummary } from '../src/app/todayView';
import { renderToday } from '../src/app/views/today';
import type { DatasetMeta, WeatherDay } from '../src/data/schema';
import type { AlarmModel } from '../src/model/alarmModel';

const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, 'utf8')) as T;
const meta = read<DatasetMeta>('meta.json');
const alarm = read<{ alarm: AlarmModel }>('model.json').alarm;
const weather = [...read<WeatherDay[]>('weather.json'), ...read<WeatherDay[]>('weather-current.json')];

describe('muotoilu', () => {
  it('käyttää suomalaista desimaalipilkkua', () => {
    expect(fmtNum(0.1349, 2)).toBe('0,13');
    expect(fmtNum(-0.04, 1)).toBe('0,0');
    expect(fmtNum(-3.2, 0)).toBe('-3');
    expect(fmtPercent(0.157)).toBe('16 %');
    expect(fmtPercent(0.004)).toBe('alle 1 %');
  });

  it('esittää kertoimet ymmärrettävästi', () => {
    expect(fmtEffect(1.4)).toBe('40 % tavallista enemmän');
    expect(fmtEffect(0.4)).toBe('60 % tavallista vähemmän');
    expect(fmtEffect(2.06)).toBe('noin 2,1-kertaisesti tavalliseen verrattuna');
    expect(fmtPercent(-0.01)).toBe('0 %');
    expect(fmtRatio(1.02)).toBe('tavallisen päivän tasoa');
    expect(fmtRatio(1.3)).toBe('noin 30 % tavallista enemmän');
    expect(fmtRatio(0.8)).toBe('noin 20 % tavallista vähemmän');
  });

  it('muotoilee päivän ja laskee Suomen ajan päivämäärän', () => {
    expect(fmtDate('2026-10-21', 2)).toBe('ke 21.10.');
    // 21.10. klo 22.30 UTC on Suomessa jo 22.10.
    expect(todayInHelsinki(new Date('2026-10-21T22:30:00Z'))).toBe('2026-10-22');
    expect(todayInHelsinki(new Date('2026-10-21T20:30:00Z'))).toBe('2026-10-21');
  });
});

describe('päivän valinta', () => {
  const dates = new Set(['2024-02-28', '2024-02-29', '2025-02-28', '2026-02-28', '2026-07-01']);

  it('käyttää pyydettyä päivää, jos säätä on', () => {
    expect(resolveDate(dates, '2026-07-01', '2024-02-28', '2026-07-01')).toBe('2026-07-01');
  });

  it('korvaa datan ulkopuolisen päivän samalla kalenteripäivällä', () => {
    expect(resolveDate(dates, '2030-02-28', '2024-02-28', '2026-07-01')).toBe('2026-02-28');
    expect(resolveDate(dates, '2028-02-29', '2024-02-28', '2026-07-01')).toBe('2026-02-28');
    expect(resolveDate(dates, '2020-02-29', '2024-02-28', '2026-07-01')).toBe('2024-02-29');
  });

  it('lukee päivän osoitteesta vain oikeassa muodossa', () => {
    expect(requestedDate('?pvm=2026-01-14', '2026-10-21')).toBe('2026-01-14');
    expect(requestedDate('?pvm=huomenna', '2026-10-21')).toBe('2026-10-21');
    expect(requestedDate('', '2026-10-21')).toBe('2026-10-21');
  });

  it('reitittää tuntemattoman osoitteen Tänään-näkymään', () => {
    expect(parseRoute('#/kartta')).toBe('kartta');
    expect(parseRoute('#/jotain')).toBe('tanaan');
    expect(parseRoute('')).toBe('tanaan');
  });
});

describe('Tänään-näkymä', () => {
  it('näyttää nykysään ja ennusteen tälle päivälle', () => {
    const v = buildTodayView(alarm, weather, '2026-10-21');
    expect(v.date).toBe('2026-10-21');
    expect(v.substitutedFor).toBeNull();
    expect(v.dateLabel).toBe('ke 21.10.');
    expect(v.probAtLeastOne).toBeCloseTo(1 - Math.exp(-v.expected), 10);
    expect(v.week.days).toHaveLength(7);
    expect(v.week.days[0]!.date).toBe('2026-10-21');
    expect(v.week.total).toBeGreaterThan(v.expected);
    expect(v.topTypes).toHaveLength(3);
    expect(v.peak.endHour - v.peak.startHour).toBe(4);
  });

  it('nostaa liukkauden syyksi liukkaana päivänä', () => {
    const day = weather.find((w) => w.date >= '2026-01-01' && w.slipperiness === 3)!;
    const v = buildTodayView(alarm, weather, day.date);
    expect(v.reasons.map((r) => r.title)).toContain('Erittäin liukas keli');
    const slip = v.reasons.find((r) => r.title === 'Erittäin liukas keli')!;
    expect(slip.detail).toMatch(/liikenneonnettomuuksia|ensivastetehtäviä/i);
  });

  it('pakkaspäivänä lämmitys näkyy syynä perusteluineen', () => {
    const day = weather.find((w) => w.date >= '2026-11-01' && w.tempMean < -8)!;
    const v = buildTodayView(alarm, weather, day.date);
    const heating = v.reasons.find((r) => /pakkanen/i.test(r.title))!;
    expect(heating.detail).toMatch(/^Rakennuspaloja/);
    expect(heating.note).toMatch(/nokipalot/);
  });

  it('lumipeitteen aikana maastopaloja ei esitetä riskiä nostavana', () => {
    const snowy = weather.filter((w) => w.date >= '2026-01-01' && w.snowDepthCm > 0);
    for (const w of snowy) {
      const v = buildTodayView(alarm, weather, w.date);
      for (const r of v.reasons) expect(r.detail).not.toMatch(/maastopaloja/i);
    }
  });

  it('maastopaloriski on 1 lumipeitteellä', () => {
    const day = weather.find((w) => w.date >= '2026-01-01' && w.snowDepthCm > 10)!;
    expect(buildTodayView(alarm, weather, day.date).wildfire.level).toBe(1);
  });

  it('kertoo, jos päivä on korvattu', () => {
    const v = buildTodayView(alarm, weather, '2035-06-15');
    expect(v.substitutedFor).toBe('2035-06-15');
    expect(v.date.slice(5)).toBe('06-15');
  });

  it('säätiivistelmä on luettava', () => {
    const w: WeatherDay = {
      date: '2026-01-14',
      tempMean: -0.4,
      tempMin: -2.6,
      tempMax: 1.2,
      precipMm: 4.3,
      snowDepthCm: 12,
      windMs: 6.4,
      slipperiness: 3,
    };
    expect(weatherSummary(w)).toBe('0 °C (-3...1), sadetta 4 mm, tuuli 6 m/s, lunta 12 cm, erittäin liukas keli');
  });

  it('HTML sisältää simulaatiohuomautuksen eikä pitkiä ajatusviivoja', () => {
    for (const date of ['2026-10-21', '2026-01-14', '2026-05-30', '2035-06-15']) {
      const html = renderToday(buildTodayView(alarm, weather, date), meta);
      expect(html).toContain('simuloituun dataan');
      expect(html).toContain('eivät ole virallisia ennusteita');
      expect(html).not.toContain('—');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
      // Prosenttiluvut eivät ole koskaan negatiivisia.
      expect(html).not.toMatch(/-\d+ %/);
    }
  });
});
