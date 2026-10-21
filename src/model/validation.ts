// Mallin validointi: opetus kaikilla paitsi viimeisellä vuodella, testaus viimeisellä vuodella.
// Vertailukohta on "pelkkä keskiarvo": jokaiselle tehtävätyypille sama odotusarvo joka päivä.

import { TASK_TYPES, type Dataset, type TaskType } from '../data/schema';
import { fitAlarmModel, dailyCounts, expectedByType, predictDay, type AlarmModel, type RiskLevel } from './alarmModel';
import { buildDayContexts, type DayContext } from './features';
import { fitSpatialModel } from './spatialModel';
import { wildfireRisk, type WildfireLevel } from './wildfire';

export interface ScorePair {
  model: number;
  baseline: number;
}

export interface ValidationReport {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainIncidents: number;
  testIncidents: number;
  /** Poisson-devianssi päivää kohden, tyypeittäin laskettuna ja summattuna. Pienempi on parempi. */
  dailyDeviance: ScorePair;
  /** Log-uskottavuuden parannus päivää kohden verrattuna keskiarvoon. Positiivinen = malli parempi. */
  logLikGainPerDay: number;
  /** Kuukausittaisten hälytysmäärien keskimääräinen absoluuttinen virhe. */
  monthlyMae: ScorePair;
  monthly: { actual: number[]; model: number[]; baseline: number[] };
  byType: Array<{
    taskType: TaskType;
    actual: number;
    model: number;
    baseline: number;
    /** Log-uskottavuuden parannus koko testivuodelta */
    logLikGain: number;
  }>;
  /** Testivuoden päivät ennustetun riskitason mukaan: toteutuuko korkeampi taso todella? */
  riskLevels: Array<{ level: RiskLevel; days: number; expectedPerDay: number; actualPerDay: number }>;
  /** Riskikartta: testihälytysten keskimääräinen log-pistemäärä verrattuna tasajakaumaan. */
  spatialLogScoreVsUniform: number;
  /** Maastopaloindeksi koko aineistossa (indeksiä ei sovitettu datan perusteella). */
  wildfire: Array<{ level: WildfireLevel; days: number; fires: number; firesPer100Days: number }>;
}

function logFactorial(k: number): number {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
}

const poissonLogLik = (y: number, lambda: number): number =>
  y * Math.log(Math.max(lambda, 1e-12)) - lambda - logFactorial(y);

const poissonDeviance = (y: number, lambda: number): number =>
  2 * ((y > 0 ? y * Math.log(y / Math.max(lambda, 1e-12)) : 0) - (y - lambda));

export function splitByLastYear(days: readonly DayContext[]): { train: DayContext[]; test: DayContext[]; testYear: string } {
  const testYear = days[days.length - 1]!.date.slice(0, 4);
  return {
    train: days.filter((d) => d.date.slice(0, 4) < testYear),
    test: days.filter((d) => d.date.slice(0, 4) === testYear),
    testYear,
  };
}

export function validateModel(ds: Dataset): ValidationReport {
  const days = buildDayContexts(ds.weather);
  const { train, test, testYear } = splitByLastYear(days);
  if (train.length === 0 || test.length === 0) throw new Error('validointi vaatii vähintään kaksi vuotta dataa');
  const trainInc = ds.incidents.filter((i) => i.time.slice(0, 4) < testYear);
  const testInc = ds.incidents.filter((i) => i.time.slice(0, 4) === testYear);

  const model: AlarmModel = fitAlarmModel(train, trainInc);
  const baselineRate = Object.fromEntries(
    TASK_TYPES.map((t) => [t, model.types[t].trainCount / train.length]),
  ) as Record<TaskType, number>;

  const counts = dailyCounts(test, testInc);
  const predictions = test.map((c) => expectedByType(model, c));

  let devModel = 0;
  let devBase = 0;
  let llGain = 0;
  const byType = TASK_TYPES.map((t) => {
    let actual = 0;
    let predicted = 0;
    let gain = 0;
    test.forEach((_, i) => {
      const y = counts[t][i]!;
      const lm = predictions[i]![t];
      const lb = baselineRate[t];
      actual += y;
      predicted += lm;
      devModel += poissonDeviance(y, lm);
      devBase += poissonDeviance(y, lb);
      gain += poissonLogLik(y, lm) - poissonLogLik(y, lb);
    });
    llGain += gain;
    return { taskType: t, actual, model: predicted, baseline: baselineRate[t] * test.length, logLikGain: gain };
  });

  const monthly = { actual: new Array<number>(12).fill(0), model: new Array<number>(12).fill(0), baseline: new Array<number>(12).fill(0) };
  const baseTotal = TASK_TYPES.reduce((s, t) => s + baselineRate[t], 0);
  test.forEach((c, i) => {
    monthly.actual[c.month]! += TASK_TYPES.reduce((s, t) => s + counts[t][i]!, 0);
    monthly.model[c.month]! += TASK_TYPES.reduce((s, t) => s + predictions[i]![t], 0);
    monthly.baseline[c.month]! += baseTotal;
  });
  const mae = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + Math.abs(x - b[i]!), 0) / a.length;

  const levels: RiskLevel[] = ['matala', 'kohonnut', 'korkea'];
  const levelStats = new Map(levels.map((l) => [l, { days: 0, expected: 0, actual: 0 }]));
  test.forEach((c, i) => {
    const p = predictDay(model, c);
    const s = levelStats.get(p.level)!;
    s.days++;
    s.expected += p.total;
    s.actual += TASK_TYPES.reduce((sum, t) => sum + counts[t][i]!, 0);
  });

  const spatial = fitSpatialModel(ds.grid, trainInc);
  const cellIndex = new Map(spatial.cellIds.map((id, i) => [id, i]));
  const nCells = spatial.cellIds.length;
  let spatialScore = 0;
  for (const inc of testInc) {
    const j = cellIndex.get(inc.cellId);
    if (j !== undefined) spatialScore += Math.log(spatial.shares[inc.taskType][j]! * nCells);
  }

  const fireDays = dailyCounts(days, ds.incidents).maastopalo;
  const wf = new Map<WildfireLevel, { days: number; fires: number }>();
  for (const l of [1, 2, 3, 4, 5] as WildfireLevel[]) wf.set(l, { days: 0, fires: 0 });
  days.forEach((c, i) => {
    const s = wf.get(wildfireRisk(c).level)!;
    s.days++;
    s.fires += fireDays[i]!;
  });

  return {
    trainStart: train[0]!.date,
    trainEnd: train[train.length - 1]!.date,
    testStart: test[0]!.date,
    testEnd: test[test.length - 1]!.date,
    trainIncidents: trainInc.length,
    testIncidents: testInc.length,
    dailyDeviance: { model: devModel / test.length, baseline: devBase / test.length },
    logLikGainPerDay: llGain / test.length,
    monthlyMae: { model: mae(monthly.model, monthly.actual), baseline: mae(monthly.baseline, monthly.actual) },
    monthly,
    byType,
    riskLevels: levels.map((l) => {
      const s = levelStats.get(l)!;
      return {
        level: l,
        days: s.days,
        expectedPerDay: s.days ? s.expected / s.days : 0,
        actualPerDay: s.days ? s.actual / s.days : 0,
      };
    }),
    spatialLogScoreVsUniform: testInc.length ? spatialScore / testInc.length : 0,
    wildfire: [...wf].map(([level, s]) => ({
      level,
      days: s.days,
      fires: s.fires,
      firesPer100Days: s.days ? (100 * s.fires) / s.days : 0,
    })),
  };
}
