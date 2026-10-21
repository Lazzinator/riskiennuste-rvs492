// Säädatasta johdetut apusuureet. Käytössä sekä generaattorissa että mallissa.

import type { WeatherDay } from './schema';

/** Päiviä edellisestä vähintään 1 mm:n sateesta (0 = satoi tänään). */
export function daysSinceRain(weather: readonly WeatherDay[]): number[] {
  const out: number[] = [];
  let n = 10; // oletetaan jakson alkuun keskimääräinen tilanne
  for (const w of weather) {
    n = w.precipMm >= 1 ? 0 : n + 1;
    out.push(n);
  }
  return out;
}

/**
 * Päivän keskilämpötila miinus edellisen 7 päivän keskiarvo. Negatiivinen = sää kylmenee.
 * Jakson alussa käytetään niitä edellisiä päiviä, jotka ovat saatavilla.
 */
export function temperatureChange(weather: readonly WeatherDay[], days = 7): number[] {
  return weather.map((w, i) => {
    const prev = weather.slice(Math.max(0, i - days), i);
    if (prev.length === 0) return 0;
    return w.tempMean - prev.reduce((s, p) => s + p.tempMean, 0) / prev.length;
  });
}
