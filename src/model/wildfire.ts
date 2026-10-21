// Maastopaloriski-indeksi 1-5. Tarkoituksella yksinkertainen pisteytys, jonka jäsen voi
// laskea päässään. Myöhemmin voidaan verrata Ilmatieteen laitoksen metsäpaloindeksiin.

import type { DayContext } from './features';

export type WildfireLevel = 1 | 2 | 3 | 4 | 5;

export const WILDFIRE_LEVEL_LABELS: Record<WildfireLevel, string> = {
  1: 'hyvin pieni',
  2: 'pieni',
  3: 'kohtalainen',
  4: 'suuri',
  5: 'erittäin suuri',
};

export interface WildfireRisk {
  level: WildfireLevel;
  score: number;
  /** Pisteitä tuottaneet tekijät, esim. "9 päivää ilman sadetta (+3)" */
  reasons: string[];
}

export function wildfireRisk(ctx: DayContext): WildfireRisk {
  const w = ctx.weather;
  if (w.snowDepthCm > 0) return { level: 1, score: 0, reasons: ['maassa on lunta'] };

  const reasons: string[] = [];
  let score = 0;
  const addPoints = (points: number, reason: string): void => {
    if (points === 0) return;
    score += points;
    reasons.push(`${reason} (${points > 0 ? '+' : ''}${points})`);
  };

  const d = ctx.dryDays;
  const dryPts = d >= 10 ? 4 : d >= 6 ? 3 : d >= 3 ? 2 : d >= 1 ? 1 : 0;
  addPoints(dryPts, d === 1 ? '1 päivä ilman sadetta' : `${d} päivää ilman sadetta`);

  const t = w.tempMax;
  addPoints(t > 24 ? 3 : t >= 18 ? 2 : t >= 10 ? 1 : 0, `ylin lämpötila ${t.toFixed(0)} °C`);

  addPoints(w.windMs >= 7 ? 2 : w.windMs >= 4 ? 1 : 0, `tuuli ${w.windMs.toFixed(0)} m/s`);

  // Keväällä maassa on kuivaa viimevuotista ruohoa, joka syttyy helposti.
  if (ctx.month >= 3 && ctx.month <= 5) addPoints(2, 'kevät: kuivaa ruohoa maastossa');
  else if (ctx.month === 6 || ctx.month === 7) addPoints(1, 'kesä');

  if (w.precipMm >= 2) addPoints(-3, `sadetta ${w.precipMm.toFixed(0)} mm`);

  score = Math.max(0, score);
  const level: WildfireLevel = score >= 9 ? 5 : score >= 7 ? 4 : score >= 5 ? 3 : score >= 3 ? 2 : 1;
  return { level, score, reasons };
}
