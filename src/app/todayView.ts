// Tänään-näkymän sisältö puhtaana funktiona: mallista ja säästä näytettäviksi luvuiksi
// ja teksteiksi. Ei riipu selaimesta, joten sitä voi testata suoraan.

import { TASK_TYPES, TASK_TYPE_LABELS, type TaskType, type WeatherDay } from '../data/schema';
import {
  hourlyExpected,
  peakWindow,
  predictDay,
  predictRange,
  type AlarmModel,
  type Reason,
  type RiskLevel,
} from '../model/alarmModel';
import { buildDayContexts, FEATURES, partOfDay, type Feature, type FeatureKey } from '../model/features';
import { WILDFIRE_LEVEL_LABELS, wildfireRisk, type WildfireLevel } from '../model/wildfire';
import { capitalize, fmtDate, fmtEffect, fmtNum, TASK_PARTITIVE } from './format';

export interface ReasonView {
  title: string;
  detail: string;
  /** Miksi tekijä vaikuttaa (vain osalla sääselittäjistä) */
  note?: string;
}

export interface DayRow {
  date: string;
  label: string;
  level: RiskLevel;
  probAtLeastOne: number;
  /** null, kun oikeaa säätä ei ole */
  wildfireLevel: WildfireLevel | null;
  weather: string;
}

export interface TodayView {
  /** Päivä, jonka luvut näytetään */
  date: string;
  dateLabel: string;
  /** Pyydetty päivä, jos simuloitua säätä ei ollut ja käytettiin vastaavaa päivää */
  substitutedFor: string | null;
  /** null, kun oikeaa säätä ei ole */
  weather: string | null;
  /** Onko päivän sää ennuste (true) vai havainto (false) */
  weatherIsForecast: boolean;
  level: RiskLevel;
  levelText: string;
  ratio: number;
  expected: number;
  probAtLeastOne: number;
  reasons: ReasonView[];
  dampeners: ReasonView[];
  peak: { startHour: number; endHour: number; share: number; partOfDay: string };
  topTypes: Array<{ taskType: TaskType; label: string; share: number }>;
  /** null, kun oikeaa säätä ei ole: indeksi lasketaan säästä */
  wildfire: { level: WildfireLevel; label: string; reasons: string[] } | null;
  week: { total: number; ratio: number; probAtLeastOne: number; level: RiskLevel; days: DayRow[] };
}

export const LEVEL_TEXT: Record<RiskLevel, string> = {
  matala: 'Tavallinen päivä',
  kohonnut: 'Tavallista enemmän hälytyksiä',
  korkea: 'Selvästi tavallista enemmän hälytyksiä',
};

/** Montako syytä enintään näytetään. */
const MAX_REASONS = 3;
const MAX_DAMPENERS = 2;

export function reasonView(r: Reason): ReasonView {
  const title = r.key.startsWith('month:') ? `${capitalize(r.label)} (vuodenaika)` : capitalize(r.label);
  const detail = r.parts
    .slice(0, 2)
    .map((p) => `${TASK_PARTITIVE[p.taskType]} ${fmtEffect(p.multiplier)}`)
    .join(', ');
  const feature = FEATURES[r.key.split(':')[0] as FeatureKey] as Feature | undefined;
  return { title, detail: capitalize(detail), ...(feature?.note ? { note: feature.note } : {}) };
}

export function weatherSummary(w: WeatherDay): string {
  const parts = [`${fmtNum(w.tempMean, 0)} °C (${fmtNum(w.tempMin, 0)}...${fmtNum(w.tempMax, 0)})`];
  parts.push(w.precipMm >= 0.5 ? `sadetta ${fmtNum(w.precipMm, 0)} mm` : 'poutaa');
  parts.push(`tuuli ${fmtNum(w.windMs, 0)} m/s`);
  if (w.snowDepthCm > 0) parts.push(`lunta ${w.snowDepthCm} cm`);
  if (w.slipperiness > 0) parts.push(FEATURES.slipperiness.levels[w.slipperiness]!);
  return parts.join(', ');
}

function shortWeather(w: WeatherDay): string {
  const rain = w.precipMm >= 0.5 ? `, ${fmtNum(w.precipMm, 0)} mm` : '';
  const slip = w.slipperiness >= 2 ? ', liukasta' : '';
  return `${fmtNum(w.tempMax, 0)} °C${rain}${slip}`;
}

/**
 * Valitsee näytettävän päivän. Jos simuloitua säätä ei ole pyydetylle päivälle (sivua käytetään
 * datan aikavälin ulkopuolella), käytetään samaa kalenteripäivää lähimmältä vuodelta.
 */
export function resolveDate(available: ReadonlySet<string>, requested: string, first: string, last: string): string {
  if (available.has(requested)) return requested;
  const after = requested > last;
  const md = requested.slice(5);
  const startYear = Number((after ? last : first).slice(0, 4));
  // Lähin vuosi, jolla sama päivä on olemassa. Karkauspäivän tilalle käy 28.2.
  for (let k = 0; k < 8; k++) {
    const y = after ? startYear - k : startYear + k;
    if (available.has(`${y}-${md}`)) return `${y}-${md}`;
    if (md === '02-29' && available.has(`${y}-02-28`)) return `${y}-02-28`;
  }
  return after ? last : first;
}

/**
 * showWeather = false: säädataa ei ole (esim. oikea hälytysdata ilman Ilmatieteen laitoksen
 * säätä). Ennuste perustuu silloin vuodenaikaan ja viikonpäivään, eikä säätä tai
 * maastopaloindeksiä näytetä; säätaulukkoa käytetään vain päivien järjestämiseen.
 */
export function buildTodayView(
  model: AlarmModel,
  weather: readonly WeatherDay[],
  requested: string,
  showWeather = true,
): TodayView {
  const contexts = buildDayContexts(weather);
  const dates = new Set(weather.map((w) => w.date));
  const date = resolveDate(dates, requested, weather[0]!.date, weather[weather.length - 1]!.date);
  const i = contexts.findIndex((c) => c.date === date);
  const ctx = contexts[i]!;

  const day = predictDay(model, ctx);
  const peak = peakWindow(hourlyExpected(model, day));
  const topTypes = TASK_TYPES.map((t) => ({ taskType: t, label: TASK_TYPE_LABELS[t], share: day.byType[t] / day.total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);
  const wf = wildfireRisk(ctx);

  const weekContexts = contexts.slice(i, i + 7);
  const week = predictRange(model, weekContexts);

  return {
    date,
    dateLabel: fmtDate(date, ctx.weekday),
    substitutedFor: date === requested ? null : requested,
    weather: showWeather ? weatherSummary(ctx.weather) : null,
    weatherIsForecast: ctx.weather.forecast === true,
    level: day.level,
    levelText: LEVEL_TEXT[day.level],
    ratio: day.ratio,
    expected: day.total,
    probAtLeastOne: 1 - Math.exp(-day.total),
    reasons: day.reasons.slice(0, MAX_REASONS).map(reasonView),
    dampeners: day.dampeners.slice(0, MAX_DAMPENERS).map(reasonView),
    peak: { ...peak, partOfDay: partOfDay(peak.startHour + 2) },
    topTypes,
    wildfire: showWeather ? { level: wf.level, label: WILDFIRE_LEVEL_LABELS[wf.level], reasons: wf.reasons } : null,
    week: {
      total: week.total,
      ratio: week.ratio,
      probAtLeastOne: week.probAtLeastOne,
      level: week.level,
      days: week.days.map((d, k) => {
        const c = weekContexts[k]!;
        return {
          date: d.date,
          label: fmtDate(d.date, c.weekday),
          level: d.level,
          probAtLeastOne: 1 - Math.exp(-d.total),
          wildfireLevel: showWeather ? wildfireRisk(c).level : null,
          weather: showWeather ? shortWeather(c.weather) : '',
        };
      }),
    },
  };
}
