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
