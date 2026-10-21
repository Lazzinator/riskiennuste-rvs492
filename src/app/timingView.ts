// Ajankohdat-näkymän sisältö puhtaana funktiona: viikonpäivä x tunti -lämpökartta mallista
// ja kuukausijakauma toteutuneista hälytyksistä mallin tasoitetun arvion rinnalla.

import { TASK_TYPES, TASK_TYPE_LABELS, monthOf, type Incident, type TaskType } from '../data/schema';
import { expectedByType, type AlarmModel } from '../model/alarmModel';
import { MONTH_NAMES, WEEKDAY_NAMES, partOfDay, type DayContext } from '../model/features';
import { fmtNum } from './format';
import { riskClassOf, type MapTaskFilter } from './mapView';

export interface HeatCell {
  weekday: number;
  hour: number;
  /** Odotettu hälytysmäärä vuodessa tällä viikonpäivällä ja tunnilla */
  perYear: number;
  /** Suhde viikon keskimääräiseen tuntiin */
  ratio: number;
  riskClass: number;
}

export interface HourWindow {
  startHour: number;
  endHour: number;
  /** Suhde keskimääräiseen tuntiin */
  ratio: number;
  text: string;
}

export interface TimingView {
  taskLabel: string;
  /** 7 riviä (ma...su) x 24 tuntia */
  heat: HeatCell[][];
  /** Kiireisin ja hiljaisin 4 tunnin jakso vuorokaudessa, koko viikon keskiarvona */
  busiest: HourWindow;
  quietest: HourWindow;
  /** Viikonpäivien ero sanoina; vilkkain päivä mainitaan vain, jos ero on selvä */
  weekdayText: string;
  months: {
    labels: string[];
    /** Toteutuneet hälytykset keskimäärin vuodessa kuukausittain */
    actual: number[];
    /** Mallin tasoitettu arvio samalle jaksolle */
    model: number[];
    busiest: string;
    quietest: string;
  };
}

/** Viikonpäivien eroa pidetään selvänä, kun vilkkain päivä ylittää hiljaisimman vähintään näin paljon. */
const CLEAR_WEEKDAY_SPREAD = 1.15;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const typesOf = (task: MapTaskFilter): readonly TaskType[] => (task === 'kaikki' ? TASK_TYPES : [task]);

/**
 * Odotettu hälytysmäärä vuodessa viikonpäivittäin ja tunneittain. Viikonpäivä skaalaa tasoa ja
 * tuntiprofiili jakaa sen vuorokaudelle; malli olettaa vuorokausirytmin samaksi joka päivä.
 */
export function weeklyHeat(alarm: AlarmModel, task: MapTaskFilter): number[][] {
  const years = alarm.trainDays / 365.25;
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const t of typesOf(task)) {
    const m = alarm.types[t];
    const perYear = m.trainCount / years;
    const weekdaySum = m.weekday.reduce((s, x) => s + x, 0);
    for (let w = 0; w < 7; w++) {
      const dayShare = m.weekday[w]! / weekdaySum;
      for (let h = 0; h < 24; h++) heat[w]![h]! += (perYear * dayShare * m.hour[h]!) / 24;
    }
  }
  return heat;
}

function hourWindow(byHour: readonly number[], pick: 'max' | 'min'): HourWindow {
  const mean = byHour.reduce((s, x) => s + x, 0) / 24;
  let bestStart = 0;
  let bestSum = pick === 'max' ? -Infinity : Infinity;
  for (let s = 0; s + 4 <= 24; s++) {
    let sum = 0;
    for (let h = s; h < s + 4; h++) sum += byHour[h]!;
    if (pick === 'max' ? sum > bestSum : sum < bestSum) {
      bestSum = sum;
      bestStart = s;
    }
  }
  return {
    startHour: bestStart,
    endHour: bestStart + 4,
    ratio: mean > 0 ? bestSum / 4 / mean : 0,
    text: `klo ${bestStart}-${bestStart + 4} (${partOfDay(bestStart + 2)})`,
  };
}

function weekdayText(heat: number[][]): string {
  const perDay = heat.map((row) => row.reduce((s, x) => s + x, 0));
  const mean = perDay.reduce((s, x) => s + x, 0) / 7;
  const max = Math.max(...perDay);
  const min = Math.min(...perDay);
  if (mean <= 0 || max / min < CLEAR_WEEKDAY_SPREAD) return 'Viikonpäivien välillä ei ole selvää eroa.';
  const top = perDay.indexOf(max);
  return `Vilkkain viikonpäivä on ${WEEKDAY_NAMES[top]} (${fmtNum(max / mean, 1)} x keskiarvo).`;
}

export function buildTimingView(
  alarm: AlarmModel,
  incidents: readonly Incident[],
  trainDays: readonly DayContext[],
  task: MapTaskFilter,
): TimingView {
  const raw = weeklyHeat(alarm, task);
  const mean = raw.flat().reduce((s, x) => s + x, 0) / (7 * 24);
  const heat = raw.map((row, w) =>
    row.map((perYear, h) => {
      const ratio = mean > 0 ? perYear / mean : 0;
      return { weekday: w, hour: h, perYear, ratio, riskClass: riskClassOf(ratio) };
    }),
  );
  const byHour = Array.from({ length: 24 }, (_, h) => raw.reduce((s, row) => s + row[h]!, 0));

  // Sama jakso kuin mallin opetuksessa, jotta toteutunut ja malli ovat vertailukelpoisia.
  const years = alarm.trainDays / 365.25;
  const types = typesOf(task);
  const actual = new Array<number>(12).fill(0);
  for (const inc of incidents) {
    const day = inc.time.slice(0, 10);
    if (types.includes(inc.taskType) && day >= alarm.trainStart && day <= alarm.trainEnd) actual[monthOf(inc.time)]!++;
  }
  const model = new Array<number>(12).fill(0);
  for (const d of trainDays) {
    const e = expectedByType(alarm, d);
    for (const t of types) model[d.month]! += e[t];
  }
  const actualPerYear = actual.map((c) => c / years);
  const modelPerYear = model.map((c) => c / years);
  // Vilkkain ja hiljaisin kuukausi mallin tasoitetusta arviosta, ei yksittäisten vuosien sattumasta.
  const maxM = modelPerYear.indexOf(Math.max(...modelPerYear));
  const minM = modelPerYear.indexOf(Math.min(...modelPerYear));

  return {
    taskLabel: task === 'kaikki' ? 'Kaikki tehtävät' : TASK_TYPE_LABELS[task],
    heat,
    busiest: hourWindow(byHour, 'max'),
    quietest: hourWindow(byHour, 'min'),
    weekdayText: weekdayText(raw),
    months: {
      // Täydet nimet: lyhenteet "maa" ja "mar" sekoittuisivat. Kaavion akselilla näytetään numerot.
      labels: MONTH_NAMES.map(capitalize),
      actual: actualPerYear,
      model: modelPerYear,
      busiest: MONTH_NAMES[maxM]!,
      quietest: MONTH_NAMES[minM]!,
    },
  };
}
