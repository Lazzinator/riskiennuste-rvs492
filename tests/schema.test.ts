import { describe, expect, it } from 'vitest';
import {
  hourOf,
  monthOf,
  validateIncident,
  validateWeatherDay,
  weekdayOf,
  type Incident,
  type WeatherDay,
} from '../src/data/schema';

const okIncident: Incident = {
  id: 'X-1',
  time: '2024-02-29T23:59',
  taskType: 'rakennuspalo',
  urgency: 'A',
  cellId: 'r1c1',
};

const okWeather: WeatherDay = {
  date: '2024-01-15',
  tempMean: -5,
  tempMin: -9,
  tempMax: -2,
  precipMm: 1.2,
  snowDepthCm: 20,
  windMs: 4,
  slipperiness: 1,
};

describe('validointi', () => {
  it('hyväksyy kelvollisen hälytyksen', () => {
    expect(validateIncident(okIncident, new Set(['r1c1']))).toEqual([]);
  });

  it('hylkää virheelliset kentät', () => {
    const bad = { ...okIncident, time: '2023-02-29T10:00', taskType: 'x', urgency: 'E' } as unknown as Incident;
    expect(validateIncident(bad, new Set(['r1c1']))).toHaveLength(3);
    expect(validateIncident({ ...okIncident, time: '2024-01-01T24:00' })).toHaveLength(1);
    expect(validateIncident({ ...okIncident, cellId: 'zz' }, new Set(['r1c1']))).toHaveLength(1);
  });

  it('tarkistaa säädatan', () => {
    expect(validateWeatherDay(okWeather)).toEqual([]);
    expect(validateWeatherDay({ ...okWeather, tempMin: 0 })).not.toEqual([]);
    expect(validateWeatherDay({ ...okWeather, precipMm: -1 })).not.toEqual([]);
  });
});

describe('aika-apurit', () => {
  it('laskee kuukauden, tunnin ja viikonpäivän', () => {
    expect(monthOf('2024-12-24T18:00')).toBe(11);
    expect(hourOf('2024-12-24T18:00')).toBe(18);
    // 21.10.2026 on keskiviikko
    expect(weekdayOf('2026-10-21')).toBe(2);
    expect(weekdayOf('2026-10-25T03:00')).toBe(6);
  });
});
