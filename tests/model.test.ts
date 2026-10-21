import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/data/generator';
import { TASK_TYPES, type WeatherDay } from '../src/data/schema';
import {
  dailyCounts,
  fitAlarmModel,
  hourlyExpected,
  isotonicIncreasing,
  peakWindow,
  predictDay,
  predictRange,
} from '../src/model/alarmModel';
import { buildDayContexts, FEATURES, type DayContext } from '../src/model/features';
import { cellExpected, fitSpatialModel } from '../src/model/spatialModel';
import { splitByLastYear, validateModel } from '../src/model/validation';
import { wildfireRisk } from '../src/model/wildfire';

const ds = generateDataset();
const days = buildDayContexts(ds.weather);
const model = fitAlarmModel(days, ds.incidents);

// Pitkä simulaatio kertoimien palautumisen testaamiseen.
const long = generateDataset({ seed: 11, startYear: 1980, endYear: 2019 });
const longDays = buildDayContexts(long.weather);
const longModel = fitAlarmModel(longDays, long.incidents);

const weather = (over: Partial<WeatherDay> = {}): WeatherDay => ({
  date: '2026-04-24',
  tempMean: 8,
  tempMin: 2,
  tempMax: 14,
  precipMm: 0,
  snowDepthCm: 0,
  windMs: 3,
  slipperiness: 0,
  ...over,
});

const ctx = (over: Partial<WeatherDay> = {}, dryDays = 2): DayContext => {
  const w = weather(over);
  const [c] = buildDayContexts([w]);
  return { ...c!, dryDays };
};

describe('hälytysmallin sovitus', () => {
  it('odotettu kokonaismäärä vastaa opetusdataa', () => {
    const expected = days.reduce((s, d) => s + predictDay(model, d).total, 0);
    expect(expected).toBeCloseTo(ds.incidents.length, 0);
    for (const t of TASK_TYPES) {
      const e = days.reduce((s, d) => s + predictDay(model, d).byType[t], 0);
      expect(e).toBeCloseTo(model.types[t].trainCount, 0);
    }
  });

  it('kertoimet ovat positiivisia ja keskimääräisen päivän kerroin on 1', () => {
    for (const t of TASK_TYPES) {
      const m = model.types[t];
      const all = [...m.month, ...m.weekday, ...m.hour, ...Object.values(m.features).flat()];
      expect(all.every((x) => x > 0 && Number.isFinite(x))).toBe(true);
      const meanMonth = days.reduce((s, d) => s + m.month[d.month]!, 0) / days.length;
      expect(meanMonth).toBeCloseTo(1, 5);
      expect(m.hour.reduce((s, x) => s + x, 0) / 24).toBeCloseTo(1, 5);
    }
  });

  it('on deterministinen ja tuottaa JSON-muotoisen mallin', () => {
    const again = fitAlarmModel(days, ds.incidents);
    expect(JSON.stringify(again)).toBe(JSON.stringify(model));
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it('lämmitystarpeen kerroin ei pienene sään kylmetessä, vähälläkään datalla', () => {
    for (const seed of [1, 2, 3, 4, 5, 492]) {
      const d = generateDataset({ seed });
      const m = fitAlarmModel(buildDayContexts(d.weather), d.incidents);
      const h = m.types.rakennuspalo.features.heating!;
      for (let l = 1; l < h.length; l++) expect(h[l]!).toBeGreaterThanOrEqual(h[l - 1]! - 1e-12);
    }
  });

  it('isotoninen regressio yhdistää rikkovat naapurit painotetusti', () => {
    expect(isotonicIncreasing([1, 3, 2, 4], [1, 1, 1, 1])).toEqual([1, 2.5, 2.5, 4]);
    expect(isotonicIncreasing([2, 1], [3, 1])).toEqual([1.75, 1.75]);
    expect(isotonicIncreasing([1, 2, 3], [1, 1, 1])).toEqual([1, 2, 3]);
  });

  it('kutistaa kertoimet kohti ykköstä, kun dataa on vähän', () => {
    const oneYear = days.filter((d) => d.date.startsWith('2023'));
    const small = fitAlarmModel(oneYear, ds.incidents);
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    // Ilman kutistusta yhden vuoden viikonpäiväkertoimet heiluisivat rajusti.
    expect(spread(small.types.automaattinen_paloilmoitus.weekday)).toBeLessThan(0.6);
  });
});

describe('kertoimien palautuminen pitkästä simulaatiosta', () => {
  const T = longModel.types;

  it('löytää maastopalojen kevään huipun ja lumipeitteen vaikutuksen', () => {
    const m = T.maastopalo.month;
    expect(m[4]!).toBeGreaterThan(2 * m[0]!);
    expect(m[4]!).toBeGreaterThan(1.5 * m[9]!);
    const snow = T.maastopalo.features.snowCover!;
    expect(snow[1]!).toBeLessThan(0.3 * snow[0]!);
    const dry = T.maastopalo.features.dryness!;
    expect(dry[4]!).toBeGreaterThan(2 * dry[1]!);
  });

  it('löytää liukkauden vaikutuksen liikenneonnettomuuksiin', () => {
    const s = T.liikenneonnettomuus.features.slipperiness!;
    expect(s[2]! / s[0]!).toBeGreaterThan(1.5);
  });

  it('löytää lämmityksen ja kylmenevän sään vaikutuksen rakennuspaloihin', () => {
    // Rakennuspaloja on vain noin 4 vuodessa, joten tähän tarvitaan pidempi simulaatio.
    const veryLong = generateDataset({ seed: 11, startYear: 1900, endYear: 2019 });
    const m = fitAlarmModel(buildDayContexts(veryLong.weather), veryLong.incidents).types.rakennuspalo;
    const h = m.features.heating!;
    // Simulaatiossa pakkasella (noin -9 °C) noin 2,2-kertaisesti lämpimään verrattuna.
    expect(h[3]! / h[0]!).toBeGreaterThan(1.7);
    expect(h[4]!).toBeGreaterThan(h[2]!);
    const c = m.features.cooling!;
    expect(c[1]! / c[0]!).toBeGreaterThan(1.3);
    // Kausivaihtelu selittyy lämpötilalla, joten kuukausikerroin jää maltilliseksi.
    expect(Math.max(...m.month) / Math.min(...m.month)).toBeLessThan(1.6);
  }, 30_000);

  it('löytää myrskyn vaikutuksen vahingontorjuntaan', () => {
    const s = T.vahingontorjunta.features.storm!;
    expect(s[2]!).toBeGreaterThan(1.3 * s[0]!);
  });

  it('löytää viikonpäivä- ja tuntiprofiilit', () => {
    const apl = T.automaattinen_paloilmoitus;
    expect(apl.weekday[1]!).toBeGreaterThan(apl.weekday[6]!);
    expect(apl.hour[10]!).toBeGreaterThan(2 * apl.hour[3]!);
    const fire = T.maastopalo;
    expect(fire.hour[14]!).toBeGreaterThan(5 * fire.hour[3]!);
  });
});

describe('ennuste ja selitykset', () => {
  it('liukas perjantai nostaa riskiä ja liukkaus näkyy syynä', () => {
    const friday = ctx({ date: '2026-01-16', tempMean: -0.5, tempMin: -3, tempMax: 1, precipMm: 3, slipperiness: 3, snowDepthCm: 5 });
    const tuesday = ctx({ date: '2026-01-13', tempMean: -6, tempMin: -9, tempMax: -3, slipperiness: 0, snowDepthCm: 5 });
    const pf = predictDay(longModel, friday);
    const pt = predictDay(longModel, tuesday);
    expect(pf.byType.liikenneonnettomuus).toBeGreaterThan(1.5 * pt.byType.liikenneonnettomuus);
    expect(pf.reasons[0]!.label).toBe(FEATURES.slipperiness.levels[3]);
    expect(pf.reasons[0]!.parts[0]!.taskType).toBe('liikenneonnettomuus');
    expect(pf.reasons.map((r) => r.label)).toContain('perjantai');
  });

  it('kuiva ja tuulinen toukokuun päivä nostaa maastopaloriskiä, lumipeite laskee', () => {
    const dryMay = ctx({ date: '2026-05-15', tempMax: 22, windMs: 8 }, 16);
    const snowyMarch = ctx({ date: '2026-03-15', tempMax: 1, tempMean: -2, tempMin: -5, snowDepthCm: 20 }, 16);
    const a = predictDay(longModel, dryMay);
    const b = predictDay(longModel, snowyMarch);
    expect(a.byType.maastopalo).toBeGreaterThan(20 * b.byType.maastopalo);
    expect(a.reasons.some((r) => r.key.startsWith('dryness:'))).toBe(true);
    expect(b.dampeners.some((r) => r.key === 'snowCover:1')).toBe(true);
  });

  it('syyt ovat järjestyksessä ja niiden vaikutus on merkittävä', () => {
    for (const d of longDays.slice(0, 400)) {
      const p = predictDay(longModel, d);
      for (let i = 1; i < p.reasons.length; i++) expect(p.reasons[i - 1]!.extra).toBeGreaterThanOrEqual(p.reasons[i]!.extra);
      for (const r of p.reasons) expect(r.multiplier).toBeGreaterThan(1.03);
      for (const r of p.dampeners) expect(r.multiplier).toBeLessThan(0.97);
    }
  });

  it('riskitasot jakautuvat noin 80/15/5 opetusjaksolla', () => {
    const counts = { matala: 0, kohonnut: 0, korkea: 0 };
    for (const d of days) counts[predictDay(model, d).level]++;
    expect(counts.matala / days.length).toBeCloseTo(0.8, 1);
    expect(counts.korkea / days.length).toBeCloseTo(0.05, 1);
    expect(counts.korkea).toBeGreaterThan(0);
  });

  it('tuntiennuste summautuu päivän ennusteeseen ja ruuhkahuippu on iltapäivällä tai illalla', () => {
    const p = predictDay(model, days[100]!);
    const hourly = hourlyExpected(model, p);
    expect(hourly.reduce((s, x) => s + x, 0)).toBeCloseTo(p.total, 10);
    const peak = peakWindow(hourly);
    expect(peak.startHour).toBeGreaterThanOrEqual(12);
    expect(peak.endHour - peak.startHour).toBe(4);
  });

  it('viikkoennuste on päivien summa', () => {
    const week = predictRange(model, days.slice(0, 7));
    expect(week.total).toBeCloseTo(week.days.reduce((s, d) => s + d.total, 0), 10);
    expect(week.probAtLeastOne).toBeGreaterThan(0.5);
    expect(week.probAtLeastOne).toBeLessThan(1);
  });
});

describe('maastopaloindeksi', () => {
  it('on 1 lumipeitteellä ja 5 pitkän kuivan kevätjakson aikana', () => {
    expect(wildfireRisk(ctx({ snowDepthCm: 3 }, 20)).level).toBe(1);
    const high = wildfireRisk(ctx({ date: '2026-05-20', tempMax: 26, windMs: 8 }, 15));
    expect(high.level).toBe(5);
    expect(high.reasons.join(' ')).toContain('15 päivää ilman sadetta');
  });

  it('sade laskee riskiä', () => {
    const dry = wildfireRisk(ctx({ date: '2026-06-10', tempMax: 20 }, 7));
    const wet = wildfireRisk(ctx({ date: '2026-06-10', tempMax: 20, precipMm: 6 }, 0));
    expect(wet.level).toBeLessThan(dry.level);
  });

  it('korkeammilla tasoilla syttyy enemmän maastopaloja', () => {
    const fires = dailyCounts(longDays, long.incidents).maastopalo;
    const rate = [0, 0, 0, 0, 0, 0];
    const n = [0, 0, 0, 0, 0, 0];
    longDays.forEach((d, i) => {
      const l = wildfireRisk(d).level;
      rate[l]! += fires[i]!;
      n[l]!++;
    });
    const r = rate.map((x, l) => (n[l] ? x / n[l]! : 0));
    expect(r[2]!).toBeGreaterThan(r[1]!);
    expect(r[3]!).toBeGreaterThan(r[2]!);
    expect(r[4]!).toBeGreaterThan(r[3]!);
    expect(r[4]!).toBeGreaterThan(20 * r[1]!);
  });
});

describe('riskikartan malli', () => {
  const spatial = fitSpatialModel(long.grid, long.incidents);

  it('osuudet summautuvat ykköseen', () => {
    for (const t of TASK_TYPES) expect(spatial.shares[t].reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
    expect(spatial.pooled.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });

  it('liikenneonnettomuuksien riski keskittyy teille ja maastopalojen metsiin', () => {
    const top = (xs: number[]): number => xs.indexOf(Math.max(...xs));
    const traffic = spatial.shares.liikenneonnettomuus;
    const fires = spatial.shares.maastopalo;
    // Tiheimmät ruudut ovat eri paikoissa eri tehtävätyypeillä.
    expect(top(traffic)).not.toBe(top(fires));
    const tTop = long.grid.cells[top(traffic)]!;
    const fTop = long.grid.cells[top(fires)]!;
    expect(fTop.centerLat).toBeGreaterThan(tTop.centerLat);
  });

  it('ruutujen odotusarvot summautuvat päivän ennusteeseen', () => {
    const p = predictDay(longModel, longDays[50]!);
    const cells = cellExpected(spatial, p.byType);
    expect(cells.reduce((s, x) => s + x, 0)).toBeCloseTo(p.total, 10);
  });
});

describe('validointi', () => {
  it('jakaa viimeisen vuoden testijoukoksi', () => {
    const { train, test, testYear } = splitByLastYear(days);
    expect(testYear).toBe('2025');
    expect(train.length + test.length).toBe(days.length);
    expect(train.at(-1)!.date).toBe('2024-12-31');
  });

  it('malli on parempi kuin pelkkä keskiarvo oletusdatalla', () => {
    const r = validateModel(ds);
    expect(r.trainIncidents + r.testIncidents).toBe(ds.incidents.length);
    expect(r.dailyDeviance.model).toBeLessThan(r.dailyDeviance.baseline);
    expect(r.logLikGainPerDay).toBeGreaterThan(0);
    expect(r.monthlyMae.model).toBeLessThan(r.monthlyMae.baseline);
    expect(r.spatialLogScoreVsUniform).toBeGreaterThan(0);
  });

  it('malli on keskimäärin parempi kuin keskiarvo eri siemenillä', () => {
    let wins = 0;
    let gain = 0;
    const n = 12;
    for (let k = 0; k < n; k++) {
      const r = validateModel(generateDataset({ seed: 2000 + k }));
      gain += r.logLikGainPerDay;
      if (r.dailyDeviance.model < r.dailyDeviance.baseline) wins++;
    }
    expect(gain / n).toBeGreaterThan(0);
    expect(wins).toBeGreaterThanOrEqual(Math.ceil(0.75 * n));
  });
});

describe('public/data/model.json', () => {
  it('on ajan tasalla (aja npm run build-model, jos tämä epäonnistuu)', async () => {
    const { readFileSync } = await import('node:fs');
    const file = JSON.parse(readFileSync('public/data/model.json', 'utf8'));
    expect(file.source).toBe('simulated');
    expect(file.alarm.trainEnd).toBe(model.trainEnd);
    expect(file.alarm.meanDailyTotal).toBeCloseTo(model.meanDailyTotal, 4);
    expect(file.alarm.types.maastopalo.month[4]).toBeCloseTo(model.types.maastopalo.month[4]!, 3);
    const v = JSON.parse(readFileSync('public/data/validation.json', 'utf8'));
    expect(v.testIncidents).toBe(validateModel(ds).testIncidents);
  });
});
