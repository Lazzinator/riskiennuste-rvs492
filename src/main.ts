import './style.css';
import { loadAppData, requestedDate } from './app/data';
import { escapeHtml, todayInHelsinki } from './app/format';
import { parseRoute, ROUTES, type Route } from './app/router';
import { buildTodayView } from './app/todayView';
import { renderAbout } from './app/views/about';
import { bannerText, renderToday, showWeather } from './app/views/today';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="sim-banner" role="note">Pilotti: luvut perustuvat simuloituun dataan, eivät ole virallisia ennusteita.</div>
  <main id="view" aria-live="polite"><p class="muted loading">Ladataan...</p></main>
  <nav class="tabs" aria-label="Näkymät">
    ${ROUTES.map((r) => `<a href="#/${r.route}" data-route="${r.route}">${r.label}</a>`).join('')}
  </nav>
`;

const view = document.querySelector<HTMLElement>('#view')!;
const banner = document.querySelector<HTMLElement>('.sim-banner')!;
/** Edellisen näkymän siivous (esim. Leaflet-kartan poisto). */
let cleanup: (() => void) | null = null;
/** Kasvaa jokaisella reitinvaihdolla; vanhentunut lataus ei piirrä uuden näkymän päälle. */
let renderId = 0;

async function render(route: Route): Promise<void> {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.route === route);
  }
  cleanup?.();
  cleanup = null;
  const id = ++renderId;
  const stale = (): boolean => id !== renderId;
  try {
    const data = await loadAppData();
    if (stale()) return;
    banner.textContent = bannerText(data.meta);
    const date = requestedDate(location.search, todayInHelsinki());
    if (route === 'tanaan') {
      view.innerHTML = renderToday(buildTodayView(data.alarm, data.weather, date, showWeather(data.meta)), data.meta);
    } else if (route === 'kartta') {
      // Leaflet ja Chart.js ladataan vasta tarvittaessa, jotta Tänään-näkymä aukeaa nopeasti puhelimella.
      const { mountMap, renderMapShell } = await import('./app/views/map');
      if (stale()) return;
      view.innerHTML = renderMapShell(data);
      cleanup = mountMap(view, data, date);
    } else if (route === 'ajankohdat') {
      const { mountTiming, renderTimingShell } = await import('./app/views/timing');
      if (stale()) return;
      view.innerHTML = renderTimingShell();
      cleanup = mountTiming(view, data);
    } else {
      view.innerHTML = renderAbout(data);
    }
  } catch (err) {
    view.innerHTML = `<section class="view"><article class="card"><h2>Tietojen lataus epäonnistui</h2>
      <p class="muted">${escapeHtml(String(err))}</p></article></section>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => void render(parseRoute(location.hash)));
void render(parseRoute(location.hash));
