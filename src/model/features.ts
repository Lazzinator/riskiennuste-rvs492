// Mallin selittäjät. Jokainen selittäjä jakaa päivät muutamaan selkeään luokkaan,
// ja malli estimoi jokaiselle luokalle kertoimen. Luokat on valittu niin, että ne
// voi kertoa jäsenelle yhdellä lauseella ("liukas keli", "kuiva jakso").

import { weekdayOf, type TaskType, type WeatherDay } from '../data/schema';
import { daysSinceRain } from '../data/weather';

export interface DayContext {
  date: string;
  /** 0-11 */
  month: number;
  /** 0 = maanantai ... 6 = sunnuntai */
  weekday: number;
  weather: WeatherDay;
  /** Päiviä edellisestä sateesta */
  dryDays: number;
}

export function buildDayContexts(weather: readonly WeatherDay[]): DayContext[] {
  const dry = daysSinceRain(weather);
  return weather.map((w, i) => ({
    date: w.date,
    month: Number(w.date.slice(5, 7)) - 1,
    weekday: weekdayOf(w.date),
    weather: w,
    dryDays: dry[i]!,
  }));
}

export interface Feature {
  key: string;
  /** Selittäjän nimi, esim. "Liukkaus" */
  name: string;
  /** Luokkien nimet syyteksteihin, esim. "liukas keli" */
  levels: readonly string[];
  /** Luokka, jota pidetään tavallisena tilanteena (ei näytetä syynä). */
  neutralLevel: number;
  levelOf(ctx: DayContext): number;
}

export const MONTH_NAMES = [
  'tammikuu',
  'helmikuu',
  'maaliskuu',
  'huhtikuu',
  'toukokuu',
  'kesäkuu',
  'heinäkuu',
  'elokuu',
  'syyskuu',
  'lokakuu',
  'marraskuu',
  'joulukuu',
] as const;

export const WEEKDAY_NAMES = [
  'maanantai',
  'tiistai',
  'keskiviikko',
  'torstai',
  'perjantai',
  'lauantai',
  'sunnuntai',
] as const;

const bin = (x: number, edges: readonly number[]): number => {
  let i = 0;
  while (i < edges.length && x >= edges[i]!) i++;
  return i;
};

export const FEATURES = {
  slipperiness: {
    key: 'slipperiness',
    name: 'Liukkaus',
    levels: ['ei liukasta', 'paikoin liukasta', 'liukas keli', 'erittäin liukas keli'],
    neutralLevel: 0,
    levelOf: (c) => c.weather.slipperiness,
  },
  snowfall: {
    key: 'snowfall',
    name: 'Lumisade',
    levels: ['ei runsasta lumisadetta', 'runsas lumisade'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.precipMm >= 5 && c.weather.tempMean < 0.5 ? 1 : 0),
  },
  frost: {
    key: 'frost',
    name: 'Pakkanen',
    levels: ['lämmintä (yli +5 °C)', 'viileää (0...+5 °C)', 'lievä pakkanen', 'pakkanen (alle -5 °C)', 'kova pakkanen (alle -10 °C)'],
    neutralLevel: 0,
    levelOf: (c) => 4 - bin(c.weather.tempMean, [-10, -5, 0, 5]),
  },
  snowCover: {
    key: 'snowCover',
    name: 'Lumipeite',
    levels: ['ei lumipeitettä', 'lumipeite'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.snowDepthCm > 0 ? 1 : 0),
  },
  dryness: {
    key: 'dryness',
    name: 'Kuivuus',
    levels: [
      'satoi tänään',
      '1-3 päivää ilman sadetta',
      '4-7 päivää ilman sadetta',
      'kuiva jakso (8-14 päivää ilman sadetta)',
      'pitkä kuiva jakso (yli 14 päivää ilman sadetta)',
    ],
    neutralLevel: 1,
    levelOf: (c) => bin(c.dryDays, [1, 4, 8, 15]),
  },
  warmth: {
    key: 'warmth',
    name: 'Lämpötila',
    levels: ['viileä päivä (alle +10 °C)', 'lämmin päivä (+10...+20 °C)', 'helle (yli +20 °C)'],
    neutralLevel: 0,
    levelOf: (c) => bin(c.weather.tempMax, [10, 20]),
  },
  wind: {
    key: 'wind',
    name: 'Tuuli',
    levels: ['heikko tuuli', 'kohtalainen tuuli', 'navakka tuuli (yli 7 m/s)'],
    neutralLevel: 0,
    levelOf: (c) => bin(c.weather.windMs, [4, 7]),
  },
  storm: {
    key: 'storm',
    name: 'Myrsky',
    levels: ['ei myrskyä', 'kova tuuli (8-11 m/s)', 'myrskytuuli (yli 11 m/s)'],
    neutralLevel: 0,
    levelOf: (c) => bin(c.weather.windMs, [8, 11]),
  },
  heavyRain: {
    key: 'heavyRain',
    name: 'Rankkasade',
    levels: ['ei rankkasadetta', 'rankkasade (yli 15 mm)'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.precipMm >= 15 ? 1 : 0),
  },
} satisfies Record<string, Feature>;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Mitkä sääselittäjät kuuluvat millekin tehtävätyypille. Valinta perustuu
 * pelastustoimen yleiseen tietoon, ei simulaation sisäisiin kertoimiin.
 */
export const TYPE_FEATURES: Record<TaskType, readonly FeatureKey[]> = {
  ensivaste: ['slipperiness'],
  liikenneonnettomuus: ['slipperiness', 'snowfall'],
  rakennuspalo: ['frost'],
  maastopalo: ['snowCover', 'dryness', 'warmth', 'wind'],
  muu_tulipalo: ['dryness'],
  vahingontorjunta: ['storm', 'heavyRain'],
  automaattinen_paloilmoitus: [],
  muu: [],
};

/** Vuorokaudenajan nimi syyteksteihin. */
export function partOfDay(hour: number): string {
  if (hour < 6) return 'yö';
  if (hour < 10) return 'aamu';
  if (hour < 16) return 'päivä';
  if (hour < 22) return 'ilta';
  return 'myöhäisilta';
}
