import { describe, expect, it } from 'vitest';
import {
  dailyFromForecast,
  dailyFromObservations,
  fmiUrl,
  helsinkiDate,
  parseSimpleFeatures,
  stationsOf,
  type FmiValue,
} from '../src/data/fmi';
import { validateWeatherDay } from '../src/data/schema';

// Ilmatieteen laitoksen WFS simple -vastauksen rakenne (lyhennetty esimerkki).
const element = (lat: number, lon: number, time: string, param: string, value: string): string => `
  <wfs:member>
    <BsWfs:BsWfsElement gml:id="BsWfsElement.1.1.1">
      <BsWfs:Location>
        <gml:Point gml:id="BsWfsElementP.1.1.1" srsDimension="2" srsName="http://www.opengis.net/def/crs/EPSG/0/4258">
          <gml:pos>${lat} ${lon} </gml:pos>
        </gml:Point>
      </BsWfs:Location>
      <BsWfs:Time>${time}</BsWfs:Time>
      <BsWfs:ParameterName>${param}</BsWfs:ParameterName>
      <BsWfs:ParameterValue>${value}</BsWfs:ParameterValue>
    </BsWfs:BsWfsElement>
  </wfs:member>`;
const collection = (members: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection timeStamp="2026-10-21T08:00:00Z" numberMatched="${members.length}">${members.join('')}</wfs:FeatureCollection>`;

const NEAR = { lat: 60.45, lon: 23.25 };
const FAR = { lat: 60.6, lon: 23.6 };
const v = (s: { lat: number; lon: number }, time: string, param: string, value: number | null): FmiValue => ({
  ...s,
  time,
  param,
  value,
});

describe('FMI-kyselyt ja jäsennys', () => {
  it('muodostaa WFS-kyselyn', () => {
    const url = new URL(fmiUrl('fmi::observations::weather::daily::simple', { latlon: '60.44,23.26', maxlocations: 4 }));
    expect(url.origin + url.pathname).toBe('https://opendata.fmi.fi/wfs');
    expect(url.searchParams.get('storedquery_id')).toBe('fmi::observations::weather::daily::simple');
    expect(url.searchParams.get('request')).toBe('getFeature');
    expect(url.searchParams.get('maxlocations')).toBe('4');
  });

  it('jäsentää arvot ja puuttuvat arvot', () => {
    const xml = collection([
      element(60.45, 23.25, '2024-01-01T00:00:00Z', 'tday', '-5.2'),
      element(60.45, 23.25, '2024-01-01T00:00:00Z', 'snow', 'NaN'),
    ]);
    expect(parseSimpleFeatures(xml)).toEqual([
      { lat: 60.45, lon: 23.25, time: '2024-01-01T00:00:00Z', param: 'tday', value: -5.2 },
      { lat: 60.45, lon: 23.25, time: '2024-01-01T00:00:00Z', param: 'snow', value: null },
    ]);
  });

  it('nostaa virheilmoituksen virheeksi', () => {
    const xml = `<ExceptionReport><Exception exceptionCode="OperationParsingFailed"><ExceptionText>Too long time interval requested!</ExceptionText></Exception></ExceptionReport>`;
    expect(() => parseSimpleFeatures(xml)).toThrow(/FMI: Too long time interval/);
  });

  it('muuntaa UTC-ajan Suomen päivämääräksi', () => {
    expect(helsinkiDate('2024-06-30T21:30:00Z')).toBe('2024-07-01');
    expect(helsinkiDate('2024-01-15T21:30:00Z')).toBe('2024-01-15');
  });
});

describe('päiväsää havainnoista', () => {
  const daily: FmiValue[] = [
    v(NEAR, '2024-01-01T00:00:00Z', 'tday', -0.5),
    v(NEAR, '2024-01-01T00:00:00Z', 'tmin', -3),
    v(NEAR, '2024-01-01T00:00:00Z', 'tmax', 1),
    v(NEAR, '2024-01-01T00:00:00Z', 'rrday', 4.2),
    v(NEAR, '2024-01-01T00:00:00Z', 'snow', null), // lähin asema ei mittaa lunta
    v(FAR, '2024-01-01T00:00:00Z', 'snow', 12),
    v(FAR, '2024-01-01T00:00:00Z', 'tday', -9), // kauempi asema ohitetaan
    v(NEAR, '2024-01-02T00:00:00Z', 'tday', -6),
    v(NEAR, '2024-01-02T00:00:00Z', 'tmin', -9),
    v(NEAR, '2024-01-02T00:00:00Z', 'tmax', -4),
    v(NEAR, '2024-01-02T00:00:00Z', 'rrday', -1), // -1 = ei sadetta
    v(FAR, '2024-01-02T00:00:00Z', 'snow', -1), // -1 = ei lunta
  ];
  const wind = Array.from({ length: 24 }, (_, h) =>
    v(NEAR, `2024-01-01T${String(h).padStart(2, '0')}:00:00Z`, 'WS_PT1H_AVG', 4),
  ).map((x, i) => (i < 2 ? { ...x, time: x.time.replace('2024-01-01', '2023-12-31').replace(/T0[01]/, 'T23') } : x));

  const days = dailyFromObservations(daily, wind, '2024-01-01', '2024-01-03');

  it('valitsee arvon lähimmältä asemalta, jolla arvo on', () => {
    expect(days[0]!.tempMean).toBe(-0.5);
    expect(days[0]!.snowDepthCm).toBe(12);
    expect(days[0]!.precipMm).toBe(4.2);
  });

  it('tulkitsee -1 sademääräksi ja lumensyvyydeksi nolla', () => {
    expect(days[1]!.precipMm).toBe(0);
    expect(days[1]!.snowDepthCm).toBe(0);
  });

  it('laskee tuulen keskiarvon ja täydentää puuttuvan päivän', () => {
    expect(days[0]!.windMs).toBe(4);
    expect(days).toHaveLength(3);
    expect(days[2]!.tempMean).toBe(days[1]!.tempMean);
  });

  it('päättelee liukkauden ja tuottaa kelvollista säädataa', () => {
    // Vesisade nollan tuntumassa: liukasta.
    expect(days[0]!.slipperiness).toBeGreaterThanOrEqual(2);
    expect(days.flatMap(validateWeatherDay)).toEqual([]);
    expect(days.every((d) => d.forecast === undefined)).toBe(true);
  });

  it('listaa asemat etäisyyden mukaan', () => {
    const s = stationsOf(daily);
    expect(s).toHaveLength(2);
    expect(s[0]!.distanceKm).toBeLessThan(s[1]!.distanceKm);
  });
});

describe('ennustepäivät', () => {
  const hourly: FmiValue[] = [];
  // 22.10. klo 12 Suomen aikaa (09 UTC) eteenpäin; viimeiselle päivälle (25.10.) jää vain
  // muutama tunti. Huom: kesäaika päättyy 25.10.2026, jolloin vuorokaudessa on 25 tuntia.
  for (let h = 0; h < 66; h++) {
    const t = new Date(Date.UTC(2026, 9, 22, 9 + h)).toISOString();
    hourly.push(v(FMI, t, 'Temperature', 5 - h * 0.1));
    hourly.push(v(FMI, t, 'Precipitation1h', h < 24 ? 0.5 : 0));
    hourly.push(v(FMI, t, 'WindSpeedMS', 6));
  }
  const last = {
    date: '2026-10-21',
    tempMean: 6,
    tempMin: 3,
    tempMax: 9,
    precipMm: 0,
    snowDepthCm: 0,
    windMs: 3,
    slipperiness: 0 as const,
  };
  const days = dailyFromForecast(hourly, last);

  it('kokoaa päiväarvot ja merkitsee ne ennusteeksi', () => {
    expect(days[0]!.date).toBe('2026-10-22');
    expect(days.every((d) => d.forecast === true)).toBe(true);
    expect(days[0]!.windMs).toBe(6);
    expect(days[0]!.tempMax).toBeGreaterThan(days[0]!.tempMin);
    expect(days.flatMap(validateWeatherDay)).toEqual([]);
  });

  it('ohittaa jo havaitut päivät ja vajaat päivät', () => {
    expect(dailyFromForecast(hourly, { ...last, date: '2026-10-22' })[0]!.date).toBe('2026-10-23');
    // Viimeisellä päivällä on alle 12 tuntiarvoa.
    expect(days.at(-1)!.date).toBe('2026-10-24');
  });
});

const FMI = { lat: 60.44, lon: 23.26 };
