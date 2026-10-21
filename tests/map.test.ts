import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMapView, periodExpectation, riskClassOf, RISK_CLASSES, RISK_COLORS } from '../src/app/mapView';
import { buildGrid, describeCell, directionTo, SETTLEMENTS } from '../src/data/geo';
import { TASK_TYPES, type Grid, type WeatherDay } from '../src/data/schema';
import type { AlarmModel } from '../src/model/alarmModel';
import type { SpatialModel } from '../src/model/spatialModel';

const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, 'utf8')) as T;
const { alarm, spatial } = read<{ alarm: AlarmModel; spatial: SpatialModel }>('model.json');
const grid = read<Grid>('grid.json');
const weather = [...read<WeatherDay[]>('weather.json'), ...read<WeatherDay[]>('weather-current.json')];
const today = '2026-10-21';

describe('ruudun kuvaus', () => {
  it('antaa ilmansuunnan', () => {
    expect(directionTo([60, 23], [60.1, 23])).toBe('pohjoiseen');
    expect(directionTo([60, 23], [60, 23.2])).toBe('itään');
    expect(directionTo([60, 23], [59.9, 22.8])).toBe('lounaaseen');
  });

  it('nimeää taajaman, tien tai suunnan ja etäisyyden', () => {
    const descriptions = new Set(buildGrid().cells.map(describeCell));
    expect(descriptions).toContain('Inkere');
    expect(descriptions).toContain('Kaivola');
    expect(descriptions).toContain('kantatie 52 lähellä');
    expect([...descriptions].some((d) => /^(metsäinen alue|haja-asutusalue), (Inkereeltä|Kaivolasta) \d+ km /.test(d))).toBe(true);
    // Taajaman keskiruutu on taajama itse.
    const inkere = SETTLEMENTS[0]!;
    const cell = grid.cells.find(
      (c) => c.south <= inkere.center[0] && inkere.center[0] < c.north && c.west <= inkere.center[1] && inkere.center[1] < c.east,
    )!;
    expect(describeCell(cell)).toBe('Inkere');
  });
});

describe('riskikartan näkymä', () => {
  it('riskiluokat ja värit vastaavat toisiaan', () => {
    expect(RISK_COLORS).toHaveLength(RISK_CLASSES.length);
    expect(riskClassOf(0.2)).toBe(0);
    expect(riskClassOf(1)).toBe(2);
    expect(riskClassOf(3)).toBe(3);
    expect(riskClassOf(10)).toBe(4);
  });

  it('ruutujen summa vastaa jakson ennustetta ja keskiarvon suhde on 1', () => {
    for (const period of ['tanaan', 'huomenna', 'viikko', 'vuosi'] as const) {
      const v = buildMapView(alarm, spatial, grid, weather, { period, task: 'kaikki', today });
      const { byType } = periodExpectation(alarm, weather, period, today);
      const expected = TASK_TYPES.reduce((s, t) => s + byType[t], 0);
      // model.json on pyöristetty viiteen merkitsevään numeroon, joten osuuksien summa on 1 noin 1e-5 tarkkuudella.
      expect(v.total / expected).toBeCloseTo(1, 4);
      expect(v.cells).toHaveLength(grid.cells.length);
      const meanRatio = v.cells.reduce((s, c) => s + c.ratio, 0) / v.cells.length;
      expect(meanRatio).toBeCloseTo(1, 10);
    }
  });

  it('jaksot ovat oikeat', () => {
    expect(periodExpectation(alarm, weather, 'tanaan', today).dates).toEqual({ first: today, last: today });
    expect(periodExpectation(alarm, weather, 'huomenna', today).dates).toEqual({ first: '2026-10-22', last: '2026-10-22' });
    expect(periodExpectation(alarm, weather, 'viikko', today).dates).toEqual({ first: today, last: '2026-10-27' });
    const year = periodExpectation(alarm, weather, 'vuosi', today);
    expect(year.dates).toBeNull();
    const perYear = TASK_TYPES.reduce((s, t) => s + year.byType[t], 0);
    expect(perYear).toBeGreaterThan(50);
    expect(perYear).toBeLessThan(65);
  });

  it('liikenneonnettomuuksien kärkiruudut ovat teiden varsilla, maastopalojen metsissä', () => {
    const traffic = buildMapView(alarm, spatial, grid, weather, { period: 'vuosi', task: 'liikenneonnettomuus', today });
    expect(traffic.hotspots[0]!.description).toMatch(/lähellä$/);
    expect(traffic.hotspots[0]!.riskClass).toBeGreaterThanOrEqual(3);
    const fires = buildMapView(alarm, spatial, grid, weather, { period: 'vuosi', task: 'maastopalo', today });
    expect(fires.hotspots[0]!.description).toMatch(/^metsäinen alue/);
  });

  it('kärkilistassa on eri alueita, ja tehtäväjakauma näytetään vain kaikille tehtäville', () => {
    const v = buildMapView(alarm, spatial, grid, weather, { period: 'viikko', task: 'kaikki', today });
    expect(v.hotspots).toHaveLength(3);
    expect(new Set(v.hotspots.map((h) => h.description)).size).toBe(3);
    expect(v.hotspots[0]!.topTypes).toHaveLength(3);
    const shares = v.cells[0]!.topTypes.reduce((s, t) => s + t.share, 0);
    expect(shares).toBeLessThanOrEqual(1 + 1e-9);
    const one = buildMapView(alarm, spatial, grid, weather, { period: 'viikko', task: 'rakennuspalo', today });
    expect(one.cells[0]!.topTypes).toEqual([]);
  });

  it('pakkasviikolla rakennuspalojen kartta on kokonaisuudessaan korkeampi kuin kesällä', () => {
    const winter = weather.find((w) => w.date >= '2026-11-01' && w.tempMean < -8)!.date;
    const w = buildMapView(alarm, spatial, grid, weather, { period: 'viikko', task: 'rakennuspalo', today: winter });
    const s = buildMapView(alarm, spatial, grid, weather, { period: 'viikko', task: 'rakennuspalo', today: '2026-07-15' });
    expect(w.total).toBeGreaterThan(1.3 * s.total);
  });
});
