import './style.css';
import { loadAppData, requestedDate } from './app/data';
import { escapeHtml, todayInHelsinki } from './app/format';
import { parseRoute, ROUTES, type Route } from './app/router';
import { buildTodayView } from './app/todayView';
import { renderToday, simulationNote } from './app/views/today';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="sim-banner" role="note">Pilotti: luvut perustuvat simuloituun dataan, eivät ole virallisia ennusteita.</div>
  <main id="view" aria-live="polite"><p class="muted loading">Ladataan...</p></main>
  <nav class="tabs" aria-label="Näkymät">
    ${ROUTES.map((r) => `<a href="#/${r.route}" data-route="${r.route}">${r.label}</a>`).join('')}
  </nav>
`;

const view = document.querySelector<HTMLElement>('#view')!;

async function render(route: Route): Promise<void> {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.route === route);
  }
  try {
    const data = await loadAppData();
    if (route === 'tanaan') {
      const date = requestedDate(location.search, todayInHelsinki());
      view.innerHTML = renderToday(buildTodayView(data.alarm, data.weather, date), data.meta);
    } else {
      const label = ROUTES.find((r) => r.route === route)!.label;
      view.innerHTML = `<section class="view"><header class="view-head"><h1>${label}</h1></header>
        <article class="card"><p class="muted">Tämä näkymä on vielä rakenteilla.</p></article>
        ${simulationNote(data.meta)}</section>`;
    }
  } catch (err) {
    view.innerHTML = `<section class="view"><article class="card"><h2>Tietojen lataus epäonnistui</h2>
      <p class="muted">${escapeHtml(String(err))}</p></article></section>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => void render(parseRoute(location.hash)));
void render(parseRoute(location.hash));
