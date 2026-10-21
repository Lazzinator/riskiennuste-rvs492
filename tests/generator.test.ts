import { describe, expect, it } from 'vitest';
import { ANNUAL_TARGETS, generateDataset } from '../src/data/generator';
import { daysSinceRain } from '../src/data/weather';
import { TASK_TYPES, hourOf, monthOf, validateDataset, validateWeatherDay, weekdayOf, type Dataset } from '../src/data/schema';

const ds = generateDataset();
// Pitkä simulaatio tilastollisia testejä varten: 5 vuoden otos on liian pieni.
const long = generateDataset({ seed: 7, startYear: 1990, endYear: 2029 });

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const countBy = <T>(xs: readonly T[], key: (x: T) => number, n: number): number[] => {
  const out = new Array<number>(n).fill(0);
  for (const x of xs) out[key(x)]!++;
  return out;
};

describe('generateDataset', () => {
  it('on deterministinen', () => {
    const again = generateDataset();
    expect(JSON.stringify(again)).toBe(JSON.stringify(ds));
    const other = generateDataset({ seed: 1 });
    expect(JSON.stringify(other.incidents)).not.toBe(JSON.stringify(ds.incidents));
  });

  it('noudattaa skeemaa', () => {
    expect(validateDataset(ds)).toEqual([]);
    expect(validateDataset(long)).toEqual([]);
    expect(ds.meta.source).toBe('simulated');
    expect(ds.meta.startDate).toBe('2021-01-01');
    expect(ds.meta.endDate).toBe('2025-12-31');
  });

  it('sisältää säädatan jokaiselle päivälle', () => {
    expect(ds.weather).toHaveLength(365 * 5 + 1); // 2024 on karkausvuosi
    expect(new Set(ds.weather.map((w) => w.date)).size).toBe(ds.weather.length);
  });

  it('hälytykset ovat aikajärjestyksessä ja tunnisteet juoksevia', () => {
    const times = ds.incidents.map((i) => i.time);
    expect([...times].sort()).toEqual(times);
    expect(ds.incidents[0]!.id).toBe(`SIM-${times[0]!.slice(0, 4)}-0001`);
  });

  it('ei sisällä henkilötietoja tai tarkkoja sijainteja', () => {
    for (const inc of ds.incidents) {
      expect(Object.keys(inc).sort()).toEqual(['cellId', 'id', 'taskType', 'time', 'urgency']);
    }
  });
});

describe('kalibrointi', () => {
  it('tuottaa noin 55-60 hälytystä vuodessa', () => {
    expect(ds.incidents.length).toBeGreaterThan(240);
    expect(ds.incidents.length).toBeLessThan(330);
    const perYear = long.incidents.length / 40;
    expect(perYear).toBeGreaterThan(54);
    expect(perYear).toBeLessThan(61);
  });

  it('tehtävätyyppien osuudet vastaavat tavoitteita', () => {
    const total = Object.values(ANNUAL_TARGETS).reduce((s, x) => s + x, 0);
    for (const t of TASK_TYPES) {
      const share = long.incidents.filter((i) => i.taskType === t).length / long.incidents.length;
      expect(share).toBeCloseTo(ANNUAL_TARGETS[t] / total, 1);
    }
  });

  it('käyttää kaikkia kiireellisyysluokkia', () => {
    expect(new Set(long.incidents.map((i) => i.urgency))).toEqual(new Set(['A', 'B', 'C', 'D']));
    const fires = long.incidents.filter((i) => i.taskType === 'rakennuspalo');
    expect(fires.filter((i) => i.urgency === 'B').length / fires.length).toBeGreaterThan(0.6);
  });
});

describe('ajallinen vaihtelu', () => {
  const of = (d: Dataset, t: string) => d.incidents.filter((i) => i.taskType === t);

  it('maastopalojen huippu on huhti-kesäkuussa', () => {
    const fires = of(long, 'maastopalo');
    const byMonth = countBy(fires, (i) => monthOf(i.time), 12);
    const spring = byMonth[3]! + byMonth[4]! + byMonth[5]!;
    expect(spring / fires.length).toBeGreaterThan(0.5);
    expect(byMonth[0]! + byMonth[1]! + byMonth[11]!).toBeLessThan(0.03 * fires.length);
  });

  it('rakennuspaloja on talvella enemmän kuin kesällä', () => {
    const byMonth = countBy(of(long, 'rakennuspalo'), (i) => monthOf(i.time), 12);
    expect(byMonth[0]! + byMonth[1]! + byMonth[11]!).toBeGreaterThan(1.6 * (byMonth[5]! + byMonth[6]! + byMonth[7]!));
  });

  it('iltaisin ja viikonloppuisin on enemmän hälytyksiä', () => {
    const byHour = countBy(long.incidents, (i) => hourOf(i.time), 24);
    const evening = mean(byHour.slice(16, 21));
    const night = mean(byHour.slice(2, 6));
    expect(evening).toBeGreaterThan(3 * night);
    const byWeekday = countBy(long.incidents, (i) => weekdayOf(i.time), 7);
    expect(mean(byWeekday.slice(4, 7))).toBeGreaterThan(mean(byWeekday.slice(0, 4)));
  });

  it('liikenneonnettomuuksia on enemmän liukkailla keleillä', () => {
    const slipDays = new Set(long.weather.filter((w) => w.slipperiness >= 2).map((w) => w.date));
    const normalDays = long.weather.length - slipDays.size;
    const traffic = of(long, 'liikenneonnettomuus');
    const onSlip = traffic.filter((i) => slipDays.has(i.time.slice(0, 10))).length;
    const rateSlip = onSlip / slipDays.size;
    const rateNormal = (traffic.length - onSlip) / normalDays;
    expect(rateSlip).toBeGreaterThan(1.5 * rateNormal);
  });

  it('maastopaloja ei juuri synny lumipeitteen aikana', () => {
    const snowDays = new Set(long.weather.filter((w) => w.snowDepthCm > 0).map((w) => w.date));
    const fires = of(long, 'maastopalo');
    const onSnow = fires.filter((i) => snowDays.has(i.time.slice(0, 10))).length;
    expect(onSnow / fires.length).toBeLessThan(0.05);
  });
});

describe('sää', () => {
  const byMonth = (m: number) => long.weather.filter((w) => Number(w.date.slice(5, 7)) === m + 1);

  it('vastaa Lounais-Suomen ilmastoa', () => {
    const jan = mean(byMonth(0).map((w) => w.tempMean));
    const jul = mean(byMonth(6).map((w) => w.tempMean));
    expect(jan).toBeGreaterThan(-8);
    expect(jan).toBeLessThan(-1);
    expect(jul).toBeGreaterThan(15);
    expect(jul).toBeLessThan(19);
    const annualPrecip = long.weather.reduce((s, w) => s + w.precipMm, 0) / 40;
    expect(annualPrecip).toBeGreaterThan(500);
    expect(annualPrecip).toBeLessThan(800);
  });

  it('lunta ja liukkautta on talvella, ei kesällä', () => {
    expect(byMonth(6).every((w) => w.snowDepthCm === 0 && w.slipperiness === 0)).toBe(true);
    expect(mean(byMonth(1).map((w) => w.snowDepthCm))).toBeGreaterThan(5);
    expect(byMonth(0).filter((w) => w.slipperiness >= 2).length).toBeGreaterThan(40 * 3);
  });

  it('daysSinceRain nollautuu sadepäivänä', () => {
    const dry = daysSinceRain(ds.weather);
    ds.weather.forEach((w, i) => {
      if (w.precipMm >= 1) expect(dry[i]).toBe(0);
      else if (i > 0) expect(dry[i]).toBe(dry[i - 1]! + 1);
    });
  });
});

describe('nykysää', () => {
  it('jatkaa historiaa katkeamatta eikä muuta historiaa', async () => {
    const { generateCurrentWeather } = await import('../src/data/generator');
    const current = generateCurrentWeather();
    expect(current[0]!.date).toBe('2026-01-01');
    expect(current.at(-1)!.date).toBe('2028-12-31');
    // Lumipeite ei katoa vuodenvaihteessa.
    const last = ds.weather.at(-1)!;
    expect(Math.abs(current[0]!.snowDepthCm - last.snowDepthCm)).toBeLessThan(10);
    expect(generateDataset().weather).toEqual(ds.weather);
    expect(current.flatMap(validateWeatherDay)).toEqual([]);
  });
});
