// Testien yhteinen simuloitu sovellusdata. Logiikkaa testataan simuloidulla aineistolla, koska se
// on deterministinen ja sisältää sään; julkaistun oikean datan eheys testataan erikseen
// (published-data.test.ts).

import type { AppData } from '../src/app/data';
import { generateCurrentWeather, generateDataset } from '../src/data/generator';
import { fitAlarmModel } from '../src/model/alarmModel';
import { buildDayContexts } from '../src/model/features';
import { fitSpatialModel } from '../src/model/spatialModel';
import { validateModel } from '../src/model/validation';

const ds = generateDataset();
const weather = [...ds.weather, ...generateCurrentWeather()];
const days = buildDayContexts(ds.weather);

export const simulated: AppData = {
  meta: ds.meta,
  alarm: fitAlarmModel(days, ds.incidents),
  spatial: fitSpatialModel(ds.grid, ds.incidents),
  grid: ds.grid,
  incidents: ds.incidents,
  validation: validateModel(ds),
  weather,
};
