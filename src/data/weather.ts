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

/** Sademäärä, joka tulee lumena (cm ≈ mm), kun vuorokauden keskilämpötila on pakkasen puolella. */
export function snowfallCm(tempMean: number, precipMm: number): number {
  return tempMean < 0.5 ? precipMm : 0;
}

/**
 * Lumensyvyyden muutos päivässä: sade kertyy lumena pakkasella ja lumi sulaa astepäivämallilla.
 * Käytetään simulaatiossa ja ennustepäivinä, joilta lumensyvyyttä ei ole havaittu.
 */
export function stepSnowDepth(prevCm: number, tempMean: number, tempMax: number, precipMm: number): number {
  const melt = tempMax > 0 ? Math.max(0, tempMean + 1) : 0;
  return Math.max(0, prevCm * 0.99 + snowfallCm(tempMean, precipMm) - melt);
}

/**
 * Liukkaus 0-3 lämpötilasta ja sateesta. Havaintoja liukkaudesta ei ole, joten se päätellään
 * samalla säännöllä sekä simuloidulle että Ilmatieteen laitoksen säälle:
 * lumisade tai sade nollan tuntumassa = liukas, vesisade jäätyneelle maalle = erittäin liukas,
 * edellisen päivän sade tai sulaminen ja yöpakkanen = paikoin liukasta.
 */
export function deriveSlipperiness(
  day: { tempMean: number; tempMin: number; tempMax: number; precipMm: number },
  snowDepthCm: number,
  prev: { precipMm: number; tempMax: number } | null,
): WeatherDay['slipperiness'] {
  if (day.tempMin > 0.5) return 0;
  const snowfall = snowfallCm(day.tempMean, day.precipMm);
  const nearZero = day.tempMax >= -1.5;
  let slip = 0;
  if (snowfall >= 3) slip = Math.max(slip, 2);
  if (nearZero && day.precipMm > 0.3) slip = Math.max(slip, 2);
  if (day.tempMean > -1.5 && day.tempMean < 1.5 && day.precipMm >= 2 && snowfall === 0) slip = 3;
  if (prev && (prev.precipMm > 0.5 || (prev.tempMax > 0 && snowDepthCm > 0))) slip = Math.max(slip, 1);
  if (nearZero && snowDepthCm > 0) slip = Math.max(slip, 1);
  return slip as WeatherDay['slipperiness'];
}
