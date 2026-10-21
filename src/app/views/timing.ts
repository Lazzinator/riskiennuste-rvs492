// Ajankohdat-näkymä: viikonpäivä x tunti -lämpökartta ja kuukausijakauma.

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { TASK_TYPES, TASK_TYPE_LABELS } from '../../data/schema';
import { buildDayContexts, WEEKDAY_NAMES } from '../../model/features';
import type { AppData } from '../data';
import { escapeHtml as esc, fmtNum } from '../format';
import { RISK_CLASSES, RISK_COLORS, type MapTaskFilter } from '../mapView';
import { buildTimingView, type HeatCell, type TimingView } from '../timingView';
import { simulationNote } from './today';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Legend);

// Kaavion värit: kaksi ensimmäistä luokkaväriä tummassa teemassa (tarkistettu paletti).
const SERIES_ACTUAL = '#3987e5';
const SERIES_MODEL = '#d95926';
const GRID = '#2e3640';
const MUTED = '#9aa3ad';
const TEXT = '#e8eaed';

const WEEKDAY_SHORT = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];

const state: { task: MapTaskFilter } = { task: 'kaikki' };

function cellText(c: HeatCell): string {
  return `${WEEKDAY_NAMES[c.weekday]} klo ${c.hour}-${c.hour + 1}: ${fmtNum(c.ratio, 1)} x keskimääräinen tunti`;
}

function heatTable(v: TimingView): string {
  const head = Array.from({ length: 24 }, (_, h) => `<th scope="col">${h % 3 === 0 ? h : ''}</th>`).join('');
  const rows = v.heat
    .map(
      (row, w) =>
        `<tr><th scope="row">${WEEKDAY_SHORT[w]}</th>${row
          .map(
            (c) =>
              `<td style="background:${RISK_COLORS[c.riskClass]}" data-w="${c.weekday}" data-h="${c.hour}" title="${esc(cellText(c))}" aria-label="${esc(cellText(c))}"></td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function monthTable(v: TimingView): string {
  return `<table class="data-table"><thead><tr><th>Kuukausi</th><th>Toteutunut / v</th><th>Malli / v</th></tr></thead><tbody>${v.months.labels
    .map((l, i) => `<tr><td>${l}</td><td>${fmtNum(v.months.actual[i]!, 1)}</td><td>${fmtNum(v.months.model[i]!, 1)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function content(v: TimingView, data: AppData): string {
  const legend = RISK_CLASSES.map(
    (c, i) => `<li><span class="swatch" style="background:${RISK_COLORS[i]}"></span>${esc(c.label)}</li>`,
  ).join('');
  const period = `${data.alarm.trainStart.slice(0, 4)}-${data.alarm.trainEnd.slice(0, 4)}`;
  return `
    <div class="pair">
      <article class="card">
        <h2>Kiireisin aika</h2>
        <p class="mid">${esc(v.busiest.text)}</p>
        <p class="muted">${fmtNum(v.busiest.ratio, 1)} x keskimääräinen tunti</p>
      </article>
      <article class="card">
        <h2>Hiljaisin aika</h2>
        <p class="mid">${esc(v.quietest.text)}</p>
        <p class="muted">${fmtNum(v.quietest.ratio, 1)} x keskimääräinen tunti</p>
      </article>
    </div>

    <article class="card">
      <h2>Viikonpäivä ja kellonaika</h2>
      <div class="heat-wrap">${heatTable(v)}</div>
      <p class="muted small" id="heat-detail">Napauta ruutua nähdäksesi tarkemmin.</p>
      <p>${esc(v.weekdayText)}</p>
      <ul class="legend legend-row">${legend}</ul>
      <p class="muted small">Väri kertoo tunnin odotetun hälytysmäärän suhteessa viikon keskimääräiseen tuntiin. Malli olettaa vuorokausirytmin samaksi joka päivä; viikonpäivä muuttaa vain tasoa.</p>
    </article>

    <article class="card">
      <h2>Kuukausijakauma</h2>
      <p>Vilkkain kuukausi on ${esc(v.months.busiest)}, hiljaisin ${esc(v.months.quietest)}.</p>
      <div class="chart-box"><canvas id="month-chart" aria-label="Hälytykset kuukausittain" role="img"></canvas></div>
      <p class="muted small">Pylväät: toteutuneet hälytykset keskimäärin vuodessa (${esc(period)}). Viiva: mallin tasoitettu arvio, joka erottaa todellisen kausivaihtelun yksittäisten vuosien sattumasta.</p>
      <details><summary>Näytä taulukkona</summary>${monthTable(v)}</details>
    </article>
    ${simulationNote(data.meta)}`;
}

export function renderTimingShell(): string {
  const options = [
    `<option value="kaikki"${state.task === 'kaikki' ? ' selected' : ''}>Kaikki tehtävät</option>`,
    ...TASK_TYPES.map((t) => `<option value="${t}"${t === state.task ? ' selected' : ''}>${esc(TASK_TYPE_LABELS[t])}</option>`),
  ].join('');
  return `
  <section class="view">
    <header class="view-head">
      <p class="eyebrow">Ajankohdat</p>
      <h1>Milloin hälytyksiä tulee</h1>
    </header>
    <div class="controls"><label>Tehtävä<select id="timing-task">${options}</select></label></div>
    <div id="timing-content" class="view"></div>
  </section>`;
}

/** Piirtää sisällön runkoon. Palauttaa siivousfunktion. */
export function mountTiming(root: HTMLElement, data: AppData): () => void {
  const days = buildDayContexts(data.weather).filter(
    (d) => d.date >= data.alarm.trainStart && d.date <= data.alarm.trainEnd,
  );
  const container = root.querySelector<HTMLElement>('#timing-content')!;
  let chart: Chart | null = null;

  const draw = (): void => {
    const v = buildTimingView(data.alarm, data.incidents, days, state.task);
    chart?.destroy();
    container.innerHTML = content(v, data);

    const detail = container.querySelector<HTMLElement>('#heat-detail')!;
    container.querySelector('.heat')!.addEventListener('click', (e) => {
      const td = (e.target as HTMLElement).closest<HTMLTableCellElement>('td[data-w]');
      if (!td) return;
      const c = v.heat[Number(td.dataset.w)]![Number(td.dataset.h)]!;
      detail.textContent = `${cellText(c)[0]!.toUpperCase()}${cellText(c).slice(1)}.`;
      container.querySelectorAll('.heat td.selected').forEach((x) => x.classList.remove('selected'));
      td.classList.add('selected');
    });

    chart = new Chart(container.querySelector<HTMLCanvasElement>('#month-chart')!, {
      data: {
        labels: v.months.labels,
        datasets: [
          {
            type: 'line',
            label: 'Malli',
            data: v.months.model,
            borderColor: SERIES_MODEL,
            backgroundColor: SERIES_MODEL,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            order: 0,
          },
          {
            type: 'bar',
            label: 'Toteutunut',
            data: v.months.actual,
            backgroundColor: SERIES_ACTUAL,
            borderRadius: 4,
            borderSkipped: 'bottom',
            maxBarThickness: 18,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false },
            title: { display: true, text: 'kuukausi', color: MUTED },
            ticks: { color: MUTED, maxRotation: 0, autoSkip: false, callback: (_val, index) => String(index + 1) },
          },
          y: {
            beginAtZero: true,
            grid: { color: GRID },
            border: { display: false },
            ticks: { color: MUTED, callback: (val) => fmtNum(Number(val), 1) },
            title: { display: true, text: 'hälytystä / v', color: MUTED },
          },
        },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: TEXT, boxWidth: 12, boxHeight: 12 } },
          tooltip: {
            callbacks: {
              title: (items) => v.months.labels[items[0]?.dataIndex ?? 0] ?? '',
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(Number(ctx.parsed.y), 1)} / v`,
            },
          },
        },
      },
    });
  };

  root.querySelector('#timing-task')!.addEventListener('change', (e) => {
    state.task = (e.target as HTMLSelectElement).value as MapTaskFilter;
    draw();
  });
  draw();
  return () => chart?.destroy();
}
