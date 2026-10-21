import type { DatasetMeta } from '../../data/schema';
import { escapeHtml as esc, fmtNum, fmtPercent, fmtRatio } from '../format';
import { LEVEL_TEXT, type ReasonView, type TodayView } from '../todayView';

const reasonList = (items: readonly ReasonView[], direction: 'up' | 'down' = 'up'): string =>
  `<ul class="reasons reasons-${direction}">${items
    .map(
      (r) =>
        `<li><strong>${esc(r.title)}</strong>${r.detail ? `<span>${esc(r.detail)}</span>` : ''}` +
        `${r.note ? `<small class="why">${esc(r.note)}</small>` : ''}</li>`,
    )
    .join('')}</ul>`;

const hours = (start: number, end: number): string => `klo ${start}-${end}`;

export function simulationNote(meta: DatasetMeta): string {
  const years = `${meta.startDate.slice(0, 4)}-${meta.endDate.slice(0, 4)}`;
  return `<p class="footnote">Luvut perustuvat simuloituun dataan (${esc(years)}, siemen ${meta.seed ?? '-'}) ja simuloituun säähän. Ne eivät ole virallisia ennusteita.</p>`;
}

export function renderToday(v: TodayView, meta: DatasetMeta): string {
  const substituted = v.substitutedFor
    ? `<p class="notice">Päivälle ${esc(v.substitutedFor)} ei ole simuloitua säätä. Näytetään vastaava päivä ${esc(v.date)}.</p>`
    : '';

  // Nostavat ja laskevat tekijät erikseen: liukas keli voi nostaa riskiä, vaikka
  // vuodenaika laskee kokonaisuutta, eikä sitä saa esittää koko päivän "syynä".
  const reasons =
    v.reasons.length || v.dampeners.length
      ? (v.reasons.length ? `<h3>Nostaa riskiä</h3>${reasonList(v.reasons)}` : '') +
        (v.dampeners.length ? `<h3>Laskee riskiä</h3>${reasonList(v.dampeners, 'down')}` : '')
      : '<p class="muted">Ei tavallisesta poikkeavia tekijöitä.</p>';

  const week = v.week.days
    .map(
      (d) => `
      <li class="week-row">
        <span class="week-day">${esc(d.label)}<small>${esc(d.weather)}</small></span>
        <span class="badge level-${d.level}" title="${esc(LEVEL_TEXT[d.level])}">${esc(d.level)}</span>
        <span class="week-prob">${fmtPercent(d.probAtLeastOne)}</span>
        <span class="wf-chip wf-${d.wildfireLevel}" title="Maastopaloriski ${d.wildfireLevel}/5">${d.wildfireLevel}</span>
      </li>`,
    )
    .join('');

  return `
  <section class="view">
    <header class="view-head">
      <p class="eyebrow">Tänään</p>
      <h1>${esc(v.dateLabel)}</h1>
      <p class="muted">${esc(v.weather)}</p>
    </header>
    ${substituted}

    <article class="card hero level-${v.level}">
      <p class="pill">${esc(v.levelText)}</p>
      <p class="big">${fmtPercent(v.probAtLeastOne)}</p>
      <p class="big-label">todennäköisyys vähintään yhteen hälytykseen tänään</p>
      <p class="muted">Odotettu määrä ${fmtNum(v.expected, 2)} hälytystä, ${esc(fmtRatio(v.ratio))}.</p>
    </article>

    <article class="card">
      <h2>Mikä vaikuttaa tänään</h2>
      ${reasons}
    </article>

    <div class="pair">
      <article class="card">
        <h2>Kiireisin aika</h2>
        <p class="mid">${hours(v.peak.startHour, v.peak.endHour)}</p>
        <p class="muted">${esc(v.peak.partOfDay)}, ${fmtPercent(v.peak.share)} päivän odotetuista hälytyksistä</p>
      </article>
      <article class="card">
        <h2>Todennäköisimmät tehtävät</h2>
        <ol class="types">${v.topTypes.map((t) => `<li>${esc(t.label)} <span class="muted">${fmtPercent(t.share)}</span></li>`).join('')}</ol>
      </article>
    </div>

    <article class="card wildfire wf-${v.wildfire.level}">
      <h2>Maastopaloriski</h2>
      <p class="big">${v.wildfire.level}<span class="of">/5</span></p>
      <p class="big-label">${esc(v.wildfire.label)}</p>
      <ul class="plain">${v.wildfire.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </article>

    <article class="card">
      <h2>Seuraavat 7 päivää</h2>
      <p>Vähintään yksi hälytys: <strong>${fmtPercent(v.week.probAtLeastOne)}</strong>. Odotettu määrä ${fmtNum(v.week.total, 1)} hälytystä, ${esc(fmtRatio(v.week.ratio))}.</p>
      <div class="week-head"><span>Päivä</span><span>Riski</span><span>Hälytys</span><span>Maasto</span></div>
      <ul class="week">${week}</ul>
    </article>

    ${simulationNote(meta)}
  </section>`;
}
