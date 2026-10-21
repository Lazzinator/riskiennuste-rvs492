// Suomenkieliset muotoilut. Tehty käsin eikä Intl-rajapinnalla, jotta tulos on sama
// kaikissa selaimissa ja testeissä (fi-FI käyttää esim. erikoismiinusmerkkiä).

import type { TaskType } from '../data/schema';

export function fmtNum(x: number, decimals = 1): string {
  const s = x.toFixed(decimals).replace('.', ',');
  return s === `-${(0).toFixed(decimals).replace('.', ',')}` ? s.slice(1) : s;
}

/** Todennäköisyys prosentteina. Ei koskaan negatiivinen. */
export function fmtPercent(p: number): string {
  p = Math.max(0, p);
  const pct = Math.round(p * 100);
  if (p > 0 && pct < 1) return 'alle 1 %';
  return `${pct} %`;
}

/**
 * Kertoimen esitys syyteksteissä sanoin, ilman etumerkkejä, jotta muutosta ei lueta
 * todennäköisyydeksi: "40 % tavallista enemmän", "60 % tavallista vähemmän" tai
 * "noin 2,1-kertaisesti tavalliseen verrattuna".
 */
export function fmtEffect(multiplier: number): string {
  if (multiplier >= 2) return `noin ${fmtNum(multiplier, 1)}-kertaisesti tavalliseen verrattuna`;
  const pct = Math.round(Math.abs(multiplier - 1) * 100);
  return multiplier >= 1 ? `${pct} % tavallista enemmän` : `${pct} % tavallista vähemmän`;
}

/** Suhde tavalliseen päivään sanoina. */
export function fmtRatio(ratio: number): string {
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (pct < 5) return 'tavallisen päivän tasoa';
  return ratio > 1 ? `noin ${pct} % tavallista enemmän` : `noin ${pct} % tavallista vähemmän`;
}

const WEEKDAY_SHORT = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'] as const;

/** "ke 21.10." */
export function fmtDate(date: string, weekday: number): string {
  return `${WEEKDAY_SHORT[weekday]} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Partitiivimuodot lauseisiin "liukas keli: liikenneonnettomuuksia +40 %". */
export const TASK_PARTITIVE: Record<TaskType, string> = {
  rakennuspalo: 'rakennuspaloja',
  tarkastustehtava: 'tarkastustehtäviä',
  liikenneonnettomuus: 'liikenneonnettomuuksia',
  vahingontorjunta: 'vahingontorjuntatehtäviä',
  maastopalo: 'maastopaloja',
  muu_tulipalo: 'muita tulipaloja',
  muu: 'avunanto- ja muita tehtäviä',
};

/** Tämä päivä Suomen aikaa muodossa YYYY-MM-DD. */
export function todayInHelsinki(now: Date = new Date()): string {
  // sv-SE tuottaa valmiiksi ISO-muodon.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
