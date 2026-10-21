// Datan lataus selaimessa. Kaikki tiedostot ovat staattisia JSON-tiedostoja hakemistossa
// public/data/, joten sivu toimii ilman taustapalvelinta.

import type { DatasetMeta, WeatherDay } from '../data/schema';
import type { AlarmModel } from '../model/alarmModel';
import type { SpatialModel } from '../model/spatialModel';

export interface AppData {
  meta: DatasetMeta;
  alarm: AlarmModel;
  spatial: SpatialModel;
  /** Historia ja nykysää yhtenä aikajärjestyksessä olevana jonona */
  weather: WeatherDay[];
}

async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return (await res.json()) as T;
}

let cache: Promise<AppData> | null = null;

export function loadAppData(): Promise<AppData> {
  cache ??= (async () => {
    const [meta, model, history, current] = await Promise.all([
      loadJson<DatasetMeta>('meta.json'),
      loadJson<{ alarm: AlarmModel; spatial: SpatialModel }>('model.json'),
      loadJson<WeatherDay[]>('weather.json'),
      loadJson<WeatherDay[]>('weather-current.json'),
    ]);
    const weather = [...history, ...current.filter((w) => w.date > history[history.length - 1]!.date)];
    return { meta, alarm: model.alarm, spatial: model.spatial, weather };
  })();
  return cache;
}

/** Päivän voi asettaa osoitteessa, esim. ?pvm=2026-01-16 (esittelyä ja testausta varten). */
export function requestedDate(search: string, fallback: string): string {
  const p = new URLSearchParams(search).get('pvm');
  return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : fallback;
}
