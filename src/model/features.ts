// Mallin selittäjät. Jokainen selittäjä jakaa päivät muutamaan selkeään luokkaan,
// ja malli estimoi jokaiselle luokalle kertoimen. Luokat on valittu niin, että ne
// voi kertoa jäsenelle yhdellä lauseella ("liukas keli", "kuiva jakso").

import { weekdayOf, type TaskType, type WeatherDay } from '../data/schema';
import { daysSinceRain, temperatureChange } from '../data/weather';

export interface DayContext {
  date: string;
  /** 0-11 */
  month: number;
  /** 0 = maanantai ... 6 = sunnuntai */
  weekday: number;
  weather: WeatherDay;
  /** Päiviä edellisestä sateesta */
  dryDays: number;
  /** Keskilämpötilan muutos edellisen viikon keskiarvoon, °C (negatiivinen = kylmenee) */
  tempChange: number;
}

export function buildDayContexts(weather: readonly WeatherDay[]): DayContext[] {
  const dry = daysSinceRain(weather);
  const change = temperatureChange(weather);
  return weather.map((w, i) => ({
    date: w.date,
    month: Number(w.date.slice(5, 7)) - 1,
    weekday: weekdayOf(w.date),
    weather: w,
    dryDays: dry[i]!,
    tempChange: change[i]!,
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
  /**
   * Vaikutuksen tunnettu suunta luokasta seuraavaan: 'increasing' = kerroin ei saa pienentyä,
   * 'decreasing' = ei saa kasvaa. Esimerkiksi kylmempi sää ei vähennä lämmityksestä johtuvia
   * paloja eikä liukkaus vähennä liikenneonnettomuuksia. Rajoitus estää vähäisen datan
   * satunnaisvaihtelua tuottamasta mahdottomia kertoimia. Malli päättää edelleen vaikutuksen
   * suuruuden datasta.
   */
  monotone?: 'increasing' | 'decreasing';
  /** Lyhyt perustelu jäsenelle: miksi tämä tekijä vaikuttaa. */
  note?: string;
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
    monotone: 'increasing',
  },
  snowfall: {
    key: 'snowfall',
    name: 'Lumisade',
    levels: ['ei runsasta lumisadetta', 'runsas lumisade'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.precipMm >= 5 && c.weather.tempMean < 0.5 ? 1 : 0),
    monotone: 'increasing',
  },
  heating: {
    key: 'heating',
    name: 'Lämmitystarve',
    levels: [
      'ei lämmitystarvetta (yli +15 °C)',
      'lämmityskausi (+5...+15 °C)',
      'kylmä sää (-5...+5 °C)',
      'pakkanen (-15...-5 °C)',
      'kova pakkanen (alle -15 °C)',
    ],
    neutralLevel: 0,
    levelOf: (c) => 4 - bin(c.weather.tempMean, [-15, -5, 5, 15]),
    monotone: 'increasing',
    note: 'Lämmitys lisää palovaaraa: nokipalot nuohoamattomissa hormeissa, huonokuntoisesta hormista yläpohjaan leviävät palot ja sisään tulevat savukaasut.',
  },
  cooling: {
    key: 'cooling',
    name: 'Kylmenevä sää',
    levels: ['ei jyrkkää kylmenemistä', 'sää kylmenee jyrkästi (yli 5 °C viikon keskiarvoa kylmempää)'],
    neutralLevel: 0,
    levelOf: (c) => (c.tempChange <= -5 && c.weather.tempMean < 10 ? 1 : 0),
    monotone: 'increasing',
    note: 'Kun sää kylmenee äkillisesti, tulisijoja lämmitetään kovemmin ja pitkään käyttämättömiä hormeja otetaan käyttöön.',
  },
  snowCover: {
    key: 'snowCover',
    name: 'Lumipeite',
    levels: ['ei lumipeitettä', 'lumipeite'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.snowDepthCm > 0 ? 1 : 0),
    monotone: 'decreasing',
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
    // Lumen alla maasto ei kuivu, joten kuivuus ei vaikuta lumipeitteen aikana.
    levelOf: (c) => (c.weather.snowDepthCm > 0 ? 1 : bin(c.dryDays, [1, 4, 8, 15])),
    monotone: 'increasing',
  },
  warmth: {
    key: 'warmth',
    name: 'Lämpötila',
    levels: ['viileä päivä (alle +10 °C)', 'lämmin päivä (+10...+20 °C)', 'helle (yli +20 °C)'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.snowDepthCm > 0 ? 0 : bin(c.weather.tempMax, [10, 20])),
    monotone: 'increasing',
  },
  wind: {
    key: 'wind',
    name: 'Tuuli',
    levels: ['heikko tuuli', 'kohtalainen tuuli', 'navakka tuuli (yli 7 m/s)'],
    neutralLevel: 0,
    // Käytössä maastopaloille: tuuli ei levitä paloa lumipeitteen aikana.
    levelOf: (c) => (c.weather.snowDepthCm > 0 ? 0 : bin(c.weather.windMs, [4, 7])),
    monotone: 'increasing',
  },
  storm: {
    key: 'storm',
    name: 'Myrsky',
    levels: ['ei myrskyä', 'kova tuuli (8-11 m/s)', 'myrskytuuli (yli 11 m/s)'],
    neutralLevel: 0,
    levelOf: (c) => bin(c.weather.windMs, [8, 11]),
    monotone: 'increasing',
  },
  heavyRain: {
    key: 'heavyRain',
    name: 'Rankkasade',
    levels: ['ei rankkasadetta', 'rankkasade (yli 15 mm)'],
    neutralLevel: 0,
    levelOf: (c) => (c.weather.precipMm >= 15 ? 1 : 0),
    monotone: 'increasing',
  },
} satisfies Record<string, Feature>;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Mitkä sääselittäjät kuuluvat millekin tehtävätyypille. Valinta perustuu
 * pelastustoimen yleiseen tietoon, ei simulaation sisäisiin kertoimiin.
 */
export const TYPE_FEATURES: Record<TaskType, readonly FeatureKey[]> = {
  rakennuspalo: ['heating', 'cooling'],
  // Savun haju ja palovaroittimet: lämmityskaudella savukaasuja tulee sisään odottamatta.
  tarkastustehtava: ['heating'],
  liikenneonnettomuus: ['slipperiness', 'snowfall'],
  vahingontorjunta: ['storm', 'heavyRain'],
  maastopalo: ['snowCover', 'dryness', 'warmth', 'wind'],
  muu_tulipalo: ['dryness'],
  muu: [],
};

/** Vuorokaudenajan nimi syyteksteihin. */
export function partOfDay(hour: number): string {
  if (hour < 6) return 'yö';
  if (hour < 10) return 'aamu';
  if (hour < 12) return 'aamupäivä';
  if (hour < 17) return 'iltapäivä';
  if (hour < 22) return 'ilta';
  return 'myöhäisilta';
}
