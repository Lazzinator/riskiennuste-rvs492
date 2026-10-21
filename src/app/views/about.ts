// Tietoa pilotista: data, miten malli toimii, kuinka hyvä se on, tietosuoja ja säädata.

import { TASK_TYPES, TASK_TYPE_LABELS, type TaskType } from '../../data/schema';
import { featureKeysOf, type AlarmModel } from '../../model/alarmModel';
import { FEATURES, MONTH_NAMES, TYPE_FEATURES } from '../../model/features';
import type { ValidationReport } from '../../model/validation';
import { WILDFIRE_LEVEL_LABELS } from '../../model/wildfire';
import type { AppData } from '../data';
import { escapeHtml as esc, fmtNum, fmtPercent } from '../format';
import { LEVEL_TEXT } from '../todayView';
import { showWeather, simulationNote } from './today';

function validationSection(v: ValidationReport): string {
  const devGain = 1 - v.dailyDeviance.model / v.dailyDeviance.baseline;
  const maeGain = 1 - v.monthlyMae.model / v.monthlyMae.baseline;
  const levels = v.riskLevels
    .filter((l) => l.days > 0)
    .map(
      (l) =>
        `<tr><td>${esc(LEVEL_TEXT[l.level])}</td><td>${l.days}</td><td>${fmtNum(l.expectedPerDay * 7, 1)}</td><td>${fmtNum(l.actualPerDay * 7, 1)}</td></tr>`,
    )
    .join('');
  const wildfire = v.wildfire
    .filter((w) => w.days > 0)
    .map(
      (w) =>
        `<tr><td>${w.level} ${esc(WILDFIRE_LEVEL_LABELS[w.level])}</td><td>${w.days}</td><td>${fmtNum(w.firesPer100Days, 1)}</td></tr>`,
    )
    .join('');
  const types = v.byType
    .map(
      (t) =>
        `<tr><td>${esc(TASK_TYPE_LABELS[t.taskType])}</td><td>${t.actual}</td><td>${fmtNum(t.model, 1)}</td><td>${fmtNum(t.baseline, 1)}</td></tr>`,
    )
    .join('');

  return `
    <article class="card prose">
      <h2>Kuinka hyvä malli on</h2>
      <p>Malli opetettiin jaksolla ${esc(v.trainStart)}...${esc(v.trainEnd)} (${v.trainIncidents} hälytystä) ja testattiin viimeisellä 12 kuukaudella ${esc(v.testStart)}...${esc(v.testEnd)} (${v.testIncidents} hälytystä), joita malli ei nähnyt opetuksessa. Vertailukohta on pelkkä keskiarvo: joka päivälle sama odotettu määrä.</p>
      <table class="data-table">
        <thead><tr><th>Mittari</th><th>Malli</th><th>Keskiarvo</th></tr></thead>
        <tbody>
          <tr><td>Päivätason virhe (Poisson-devianssi)</td><td>${fmtNum(v.dailyDeviance.model, 3)}</td><td>${fmtNum(v.dailyDeviance.baseline, 3)}</td></tr>
          <tr><td>Kuukausimäärien keskivirhe</td><td>${fmtNum(v.monthlyMae.model, 2)}</td><td>${fmtNum(v.monthlyMae.baseline, 2)}</td></tr>
        </tbody>
      </table>
      <p>Malli on päivätasolla ${fmtPercent(devGain)} ja kuukausitasolla ${fmtPercent(maeGain)} tarkempi kuin keskiarvo. Päivätason ero on pieni, koska yksittäisen päivän hälytys on suurelta osin sattumaa: keskimäärin hälytys tulee noin joka kuudes päivä. Simulaatiokokeissa edes täsmälleen oikeat kertoimet paransivat päivätasoa keskimäärin vain noin 4 %. ${
        v.usesWeather ? '' : 'Ilman säätietoja malli tuntee vain vuodenajan ja viikonpäivän, joten päivätason ero jää pieneksi. '
      }Ennusteen hyöty näkyy siksi parhaiten viikko- ja kuukausitasolla sekä syissä: mitkä tekijät nostavat riskiä.</p>
      <h3>Toteutuuko riskitaso?</h3>
      <table class="data-table">
        <thead><tr><th>Ennustettu taso</th><th>Päiviä</th><th>Odotettu / vko</th><th>Toteutunut / vko</th></tr></thead>
        <tbody>${levels}</tbody>
      </table>
      <p class="muted small">Testivuoden päivät ryhmiteltynä ennustetun riskitason mukaan. Pienissä ryhmissä satunnaisvaihtelu on suurta.</p>
      <h3>Tehtävätyypit testivuonna</h3>
      <table class="data-table">
        <thead><tr><th>Tehtävä</th><th>Toteutui</th><th>Malli</th><th>Keskiarvo</th></tr></thead>
        <tbody>${types}</tbody>
      </table>
      ${
        wildfire
          ? `<h3>Maastopaloindeksi</h3>
      <table class="data-table">
        <thead><tr><th>Taso</th><th>Päiviä</th><th>Paloja / 100 pv</th></tr></thead>
        <tbody>${wildfire}</tbody>
      </table>
      <p class="muted small">Koko aineisto: maastopalojen määrä indeksin tasoittain.</p>`
          : ''
      }
      <h3>Riskikartta</h3>
      ${
        v.spatialLogScoreVsUniform === null
          ? '<p class="muted">Riskikartan validointia ei ole saatavilla.</p>'
          : `<p>Testijakson hälytykset osuivat ruutuihin, joille kartta antoi keskimääräistä suuremman riskin (log-pistemäärä ${fmtNum(v.spatialLogScoreVsUniform, 2)} tasaiseen jakaumaan verrattuna, positiivinen on parempi).</p>`
      }
    </article>`;
}

/** Kuukaudet, joina tyypin kerroin on selvästi koholla, esim. "elo-syyskuu". */
export function busyMonths(model: AlarmModel, type: TaskType, threshold = 1.2): string {
  const f = model.types[type].month;
  const high = f.map((x, m) => (x >= threshold ? m : -1)).filter((m) => m >= 0);
  if (high.length === 0) return 'ei selvää kausivaihtelua';
  // Yhtenäiset jaksot (myös vuodenvaihteen yli), esim. "joulu-helmikuu".
  const runs: number[][] = [];
  for (const m of high) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === m - 1) last.push(m);
    else runs.push([m]);
  }
  if (runs.length > 1 && runs[0]![0] === 0 && runs[runs.length - 1]!.at(-1) === 11) {
    runs[0] = [...runs.pop()!, ...runs[0]!];
  }
  const short = (m: number): string => MONTH_NAMES[m]!.replace(/kuu$/, '');
  return runs
    .map((r) => (r.length === 1 ? MONTH_NAMES[r[0]!]! : `${short(r[0]!)}-${MONTH_NAMES[r[r.length - 1]!]!}`))
    .join(', ');
}

function dataSection(data: AppData): string {
  const m = data.meta;
  if (m.source === 'simulated') {
    return `<article class="card prose notice-card">
      <h2>Simuloitu data</h2>
      <p>Tämä on Perttelin VPK:n (RVS492) pilotti. <strong>Kaikki luvut perustuvat simuloituun dataan</strong>: yksikään hälytys ei ole todellinen, ja myös sää on simuloitu. Ennusteet eivät ole virallisia.</p>
    </article>`;
  }
  const years = data.alarm.trainDays / 365.25;
  const rows = TASK_TYPES.map((t) => {
    const perYear = data.alarm.types[t].trainCount / years;
    return `<tr><td>${esc(TASK_TYPE_LABELS[t])}</td><td>${fmtNum(perYear, 1)}</td><td>${esc(busyMonths(data.alarm, t))}</td></tr>`;
  }).join('');
  return `<article class="card prose notice-card">
      <h2>Data</h2>
      <p>Ennusteet perustuvat RVS492:n ${m.incidentCount} hälytykseen PRONTOssa jaksolla ${esc(m.startDate)}...${esc(m.endDate)}, keskimäärin ${fmtNum(data.alarm.meanDailyTotal * 365.25, 0)} hälytystä vuodessa. Ennusteet ovat suuntaa antavia eivätkä virallisia.</p>
      <table class="data-table">
        <thead><tr><th>Tehtävä</th><th>Hälytyksiä / v</th><th>Vilkkain aika</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">Rakennuspaloon kuuluvat myös rakennuspalovaarat ja nokipalot, tarkastustehtäviin paloilmoitin- ja palovaroitintarkastukset, vahingontorjuntaan öljyvahingot ja muihin tulipaloihin liikennevälinepalot. "Vilkkain aika": kuukaudet, joina hälytyksiä on vähintään 20 % keskimääräistä enemmän.</p>
    </article>`;
}

function weatherSection(data: AppData): string {
  const m = data.meta;
  if (m.source === 'simulated') return '';
  const status =
    m.weatherSource === 'fmi'
      ? '<p><strong>Käytössä:</strong> havainnot lähimmiltä sääasemilta ja pistekohtainen ennuste seuraaville päiville. Tiedot päivittyvät joka yö.</p>'
      : '<p><strong>Ei vielä käytössä:</strong> säätietoja ei saatu haettua, joten ennuste perustuu nyt vuodenaikaan ja viikonpäivään. Sää otetaan käyttöön automaattisesti seuraavassa päivityksessä, kun haku onnistuu.</p>';
  return `<article class="card prose">
      <h2>Säätiedot</h2>
      <p>Sää haetaan Ilmatieteen laitoksen avoimesta datasta (opendata.fmi.fi, lisenssi CC BY 4.0): päivän keskilämpötila, ali- ja ylilämpötila, sademäärä, lumensyvyys ja tuulen keskinopeus Perttelin lähimmiltä asemilta vuodesta ${esc(m.startDate.slice(0, 4))} alkaen sekä sääennuste. Liukkautta ei mitata, joten se päätellään lämpötilasta ja sateesta.</p>
      ${status}
    </article>`;
}

function privacySection(data: AppData): string {
  if (data.meta.source === 'simulated') {
    return `<article class="card prose">
      <h2>Tietosuoja</h2>
      <p>Sovellus ei käsittele henkilötietoja. Hälytyksistä käytetään vain aikaa, tehtävätyyppiä, kiireellisyysluokkaa ja 1 km ruutua.</p>
    </article>`;
  }
  return `<article class="card prose">
      <h2>Tietosuoja</h2>
      <p>PRONTO-otteessa on osoitteita, koordinaatteja ja tietoja osallisista. Niitä ei julkaista eikä tallenneta sovellukseen. Sovellukseen tuodaan vain kunkin hälytyksen päivä ja tunti, tehtävätyyppi ja kiireellisyysluokka. Kartta lasketaan sijainneista tuonnin yhteydessä ja julkaistaan vain tasoitettuna tiheytenä (noin 1,5 km säde), josta yksittäistä kohdetta ei voi päätellä. Sivu ei kerää tietoja käyttäjistä.</p>
    </article>`;
}

/** Mihin tehtävätyyppeihin malli käyttää säätä ja millä selittäjillä. */
export function weatherUseText(model: AlarmModel): string {
  const used = TASK_TYPES.filter((t) => featureKeysOf(model.types[t]).length > 0);
  if (used.length === 0) {
    return 'säätiedot ovat käytössä, mutta yhdenkään tehtävätyypin ennuste ei parantunut niillä, joten malli ei käytä niitä.';
  }
  const parts = used.map(
    (t) => `${TASK_TYPE_LABELS[t].toLowerCase()} (${featureKeysOf(model.types[t]).map((k) => FEATURES[k].name.toLowerCase()).join(', ')})`,
  );
  const unused = TASK_TYPES.filter((t) => !used.includes(t) && TYPE_FEATURES[t].length > 0);
  return (
    `malli käyttää säätä tehtävätyypeille ${parts.join('; ')}. ` +
    (unused.length
      ? `Muilla tyypeillä (${unused.map((t) => TASK_TYPE_LABELS[t].toLowerCase()).join(', ')}) sää ei parantanut ennustetta, kun kukin vuosi testattiin vuorollaan, joten sitä ei käytetä.`
      : '')
  );
}

export function renderAbout(data: AppData): string {
  const m = data.meta;
  const weatherOn = showWeather(m);
  const features = weatherOn
    ? `<li><strong>Sää:</strong> ${esc(weatherUseText(data.alarm))}</li>
        <li><strong>Vaikutuksen suunta on lukittu,</strong> kun se tiedetään varmasti: esimerkiksi kylmempi sää ei voi vähentää lämmityksestä johtuvia paloja eikä liukkaus liikenneonnettomuuksia. Malli päättää datasta vain, kuinka suuri vaikutus on.</li>`
    : '<li><strong>Sää:</strong> ei vielä käytössä (ks. Säätiedot). Malli tuntee nyt vuodenajan, viikonpäivän ja kellonajan.</li>';
  return `
  <section class="view">
    <header class="view-head">
      <p class="eyebrow">Tietoa</p>
      <h1>Tietoa pilotista</h1>
    </header>

    ${dataSection(data)}

    <article class="card prose">
      <h2>Miten ennuste toimii</h2>
      <p>Jokaiselle tehtävätyypille on oma malli. Odotettu hälytysmäärä päivässä on</p>
      <p class="formula">perustaso x kuukausi x viikonpäivä${weatherOn ? ' x sääkertoimet' : ''}</p>
      <p>ja kokonaisennuste on tehtävätyyppien summa. Kertoimet lasketaan historiasta. Kerroin 1,0 tarkoittaa tavallista tilannetta, 1,5 puolitoistakertaista.</p>
      <ul>
        ${features}
        <li><strong>Vähäinen data:</strong> pienen palokunnan hälytyksiä on vähän, joten kertoimia vedetään kohti keskiarvoa. Yksittäinen sattuma ei siksi tee päivästä "korkean riskin" päivää.</li>
        <li><strong>Riskitaso</strong> verrataan tavalliseen päivään: kohonnut tarkoittaa vähintään 25 % ja korkea vähintään 60 % tavallista enemmän hälytyksiä.</li>
        <li><strong>Syyt:</strong> Tänään-näkymä näyttää tekijät, jotka nostavat tai laskevat riskiä eniten, ja kuinka paljon.</li>
      </ul>
    </article>

    ${
      weatherOn
        ? `<article class="card prose">
      <h2>Maastopaloriski 1-5</h2>
      <p>Yksinkertainen pisteytys, jonka voi laskea itsekin:</p>
      <ul>
        <li>päiviä edellisestä sateesta: 1-2 pv +1, 3-5 pv +2, 6-9 pv +3, vähintään 10 pv +4</li>
        <li>ylin lämpötila: +10...+17 °C +1, +18...+24 °C +2, yli +24 °C +3</li>
        <li>tuuli: 4-6 m/s +1, vähintään 7 m/s +2</li>
        <li>kevät (huhti-kesäkuu) +2, heinä-elokuu +1</li>
        <li>sadetta vähintään 2 mm: 3 pistettä vähemmän</li>
        <li>lunta maassa: aina taso 1</li>
      </ul>
      <p>Pisteet: 0-2 = 1, 3-4 = 2, 5-6 = 3, 7-8 = 4, vähintään 9 = 5. Indeksiä voidaan verrata Ilmatieteen laitoksen metsäpaloindeksiin.</p>
    </article>`
        : ''
    }

    <article class="card prose">
      <h2>Riskikartta</h2>
      <p>Ruudun (1 km x 1 km) riski on hälytysten historiallinen tiheys tasoitettuna noin 1,5 km säteelle, kerrottuna valitun ajankohdan ${weatherOn ? 'ja sään ' : ''}ennusteella.</p>
    </article>

    ${validationSection(data.validation)}
    ${weatherSection(data)}
    ${privacySection(data)}

    <article class="card prose">
      <h2>Rajoitukset</h2>
      <ul>
        <li>Hälytyksiä on vähän (noin ${fmtNum(data.alarm.meanDailyTotal * 365.25, 0)} vuodessa), joten yksittäisen päivän määrä on suurelta osin sattumaa. Ennuste kertoo, milloin riski on tavallista suurempi, ei sitä, tuleeko hälytys.</li>
        <li>Joidenkin tekijöiden vaikutus ei erotu sattumasta (esim. viikonpäivät). Malli näyttää silloin tekijän neutraalina eikä keksi vaikutusta.</li>
        <li>Malli olettaa vuorokausirytmin samaksi joka päivä, eli esimerkiksi viikonloppuöiden erityispiirteet eivät vielä näy.</li>
      </ul>
    </article>

    <p class="footnote">Data: ${esc(m.source === 'simulated' ? 'simuloitu' : 'PRONTO')}, ${esc(m.startDate)}...${esc(m.endDate)}, ${m.incidentCount} hälytystä${m.seed !== null ? `, siemen ${m.seed}` : ''}. Skeeman versio ${m.schemaVersion}.</p>
    ${simulationNote(m)}
  </section>`;
}
