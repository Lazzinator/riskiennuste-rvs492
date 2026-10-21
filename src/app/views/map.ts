// Riskikartta Leafletilla. Ruudukko piirretään suorakulmioina OpenStreetMap-taustan päälle.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TASK_TYPES, TASK_TYPE_LABELS } from '../../data/schema';
import type { AppData } from '../data';
import { escapeHtml as esc, fmtDate, fmtNum, fmtPercent } from '../format';
import {
  buildMapView,
  MAP_PERIODS,
  RISK_CLASSES,
  RISK_COLORS,
  type MapCell,
  type MapPeriod,
  type MapTaskFilter,
} from '../mapView';
import { simulationNote } from './today';

// Valinnat säilyvät, kun käyttäjä vaihtaa välilehteä ja palaa.
const state: { period: MapPeriod; task: MapTaskFilter } = { period: 'tanaan', task: 'kaikki' };

function cellPopup(c: MapCell, period: MapPeriod): string {
  const amount =
    period === 'vuosi'
      ? `Odotettu hälytysmäärä ruudussa: noin ${fmtNum(c.expected, 2)} vuodessa`
      : `Todennäköisyys vähintään yhteen hälytykseen ruudussa: ${fmtPercent(1 - Math.exp(-c.expected))}`;
  const types = c.topTypes.length
    ? `<p class="popup-sub">Todennäköisimmät tehtävät:</p><ol>${c.topTypes
        .map((t) => `<li>${esc(t.label)} ${fmtPercent(t.share)}</li>`)
        .join('')}</ol>`
    : '';
  return `<strong>${esc(c.description)}</strong>
    <p>Riski: ${esc(RISK_CLASSES[c.riskClass]!.label)} (${fmtNum(c.ratio, 1)} x)</p>
    <p>${amount}</p>${types}`;
}

function periodText(view: ReturnType<typeof buildMapView>, usesWeather: boolean): string {
  if (!view.dates) return 'historiallinen keskiarvo';
  const label = (d: string): string => fmtDate(d, (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7);
  const range = view.dates.first === view.dates.last ? label(view.dates.first) : `${label(view.dates.first)}-${label(view.dates.last)}`;
  return `${range}, ${usesWeather ? 'ennustettu sää huomioitu' : 'vuodenaika ja viikonpäivä huomioitu'}`;
}

export function renderMapShell(data: AppData): string {
  const periodOptions = MAP_PERIODS.map(
    (p) => `<option value="${p.id}"${p.id === state.period ? ' selected' : ''}>${p.label}</option>`,
  ).join('');
  const taskOptions = [
    `<option value="kaikki"${state.task === 'kaikki' ? ' selected' : ''}>Kaikki tehtävät</option>`,
    ...TASK_TYPES.map(
      (t) => `<option value="${t}"${t === state.task ? ' selected' : ''}>${esc(TASK_TYPE_LABELS[t])}</option>`,
    ),
  ].join('');
  // Pienin luokka piirretään kartalle lähes läpinäkyvänä, joten selitteessäkin vain ääriviiva.
  const legend = RISK_CLASSES.map((c, i) =>
    i === 0
      ? `<li><span class="swatch swatch-empty"></span>${esc(c.label)} (ei väriä)</li>`
      : `<li><span class="swatch" style="background:${RISK_COLORS[i]}"></span>${esc(c.label)}</li>`,
  ).join('');

  return `
  <section class="view">
    <header class="view-head">
      <p class="eyebrow">Riskikartta</p>
      <h1>Missä hälytyksiä todennäköisimmin tulee</h1>
    </header>
    <div class="controls">
      <label>Tehtävä<select id="map-task">${taskOptions}</select></label>
      <label>Ajankohta<select id="map-period">${periodOptions}</select></label>
    </div>
    <p class="muted map-caption" id="map-caption"></p>
    <div id="map" class="map" role="region" aria-label="Riskikartta 1 km ruuduissa"></div>
    <article class="card">
      <h2>Riski suhteessa alueen keskimääräiseen ruutuun</h2>
      <ul class="legend">${legend}</ul>
      <p class="muted small">Ruutu on 1 km x 1 km. Väri kertoo ruudun odotetun hälytysmäärän suhteessa koko alueen keskiarvoon. Napauta ruutua nähdäksesi tiedot.</p>
    </article>
    <article class="card">
      <h2>Riskialttiimmat alueet</h2>
      <ol class="hotspots" id="map-hotspots"></ol>
    </article>
    <article class="card">
      <h2>Miten kartta lasketaan</h2>
      <p class="muted small">Ruudun riski on hälytysten historiallinen tiheys tasoitettuna noin 1,5 km säteelle, kerrottuna valitun ajankohdan ja sään ennusteella. Yksittäisiä hälytyksiä tai niiden määriä ruuduittain ei näytetä.</p>
    </article>
    ${simulationNote(data.meta)}
  </section>`;
}

/** Luo kartan valmiiksi renderöityyn runkoon. Palauttaa siivousfunktion. */
export function mountMap(root: HTMLElement, data: AppData, today: string): () => void {
  const first = data.grid.cells[0]!;
  const map = L.map(root.querySelector<HTMLElement>('#map')!, {
    center: [first.centerLat, first.centerLon],
    zoom: 10,
    zoomSnap: 0.5,
    attributionControl: true,
    // Canvas on puhelimella selvästi kevyempi kuin SVG, kun ruutuja on toista tuhatta.
    preferCanvas: true,
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 16,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-tekijät',
  }).addTo(map);

  const cellLayer = L.layerGroup().addTo(map);
  const rects = new Map<string, L.Rectangle>();
  const caption = root.querySelector<HTMLElement>('#map-caption')!;
  const hotspotList = root.querySelector<HTMLOListElement>('#map-hotspots')!;

  const draw = (): void => {
    const view = buildMapView(data.alarm, data.spatial, data.grid, data.weather, { ...state, today });
    cellLayer.clearLayers();
    rects.clear();
    for (const c of view.cells) {
      const rect = L.rectangle(
        [
          [c.south, c.west],
          [c.north, c.east],
        ],
        {
          color: '#111418',
          weight: 0.5,
          fillColor: RISK_COLORS[c.riskClass],
          // Pienimmän luokan ruudut lähes läpinäkyviä, jotta taustakartta (kylät, tiet) erottuu.
          fillOpacity: c.riskClass === 0 ? 0.12 : 0.6,
          stroke: c.riskClass > 0,
        },
      ).bindPopup(cellPopup(c, state.period));
      rect.addTo(cellLayer);
      rects.set(c.id, rect);
    }
    caption.textContent = `${view.taskLabel}, ${view.periodLabel.toLowerCase()}: ${periodText(view, data.alarm.usesWeather)}.`;
    hotspotList.innerHTML = view.hotspots
      .map(
        (h) =>
          `<li><button type="button" data-cell="${h.id}">${esc(h.description)}</button> <span class="muted">${fmtNum(h.ratio, 1)} x keskiarvo</span></li>`,
      )
      .join('');
  };

  const onChange = (): void => {
    state.task = root.querySelector<HTMLSelectElement>('#map-task')!.value as MapTaskFilter;
    state.period = root.querySelector<HTMLSelectElement>('#map-period')!.value as MapPeriod;
    draw();
  };
  root.querySelector('#map-task')!.addEventListener('change', onChange);
  root.querySelector('#map-period')!.addEventListener('change', onChange);
  hotspotList.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cell]')?.dataset.cell;
    const rect = id ? rects.get(id) : undefined;
    if (!rect) return;
    // Ilman zoomausanimaatiota: muuten nopea välilehden vaihto kesken animaation kaataa Leafletin.
    map.fitBounds(rect.getBounds(), { maxZoom: 13, animate: false });
    rect.openPopup();
    root.querySelector('#map')!.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  draw();
  const bounds = L.latLngBounds(
    data.grid.cells.flatMap((c) => [[c.south, c.west], [c.north, c.east]] as [number, number][]),
  );
  // Säiliön lopullinen koko tiedetään vasta asettelun jälkeen. Ilman animaatiota, koska kesken
  // zoomausanimaation poistettu kartta (nopea välilehden vaihto) kaatuu Leafletissa.
  map.fitBounds(bounds, { animate: false });
  const frame = requestAnimationFrame(() => {
    map.invalidateSize({ animate: false });
    map.fitBounds(bounds, { animate: false });
  });
  return () => {
    cancelAnimationFrame(frame);
    map.stop();
    map.remove();
  };
}
