// Tietoa pilotista: miten malli toimii, kuinka hyvä se on ja miten oikea data kytketään.

import { TASK_TYPE_LABELS } from '../../data/schema';
import type { ValidationReport } from '../../model/validation';
import { WILDFIRE_LEVEL_LABELS } from '../../model/wildfire';
import type { AppData } from '../data';
import { escapeHtml as esc, fmtNum, fmtPercent } from '../format';
import { LEVEL_TEXT } from '../todayView';
import { simulationNote } from './today';

const year = (d: string): string => d.slice(0, 4);

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
      <p>Malli opetettiin vuosilla ${year(v.trainStart)}-${year(v.trainEnd)} (${v.trainIncidents} hälytystä) ja testattiin vuodella ${year(v.testStart)} (${v.testIncidents} hälytystä), jota malli ei nähnyt opetuksessa. Vertailukohta on pelkkä keskiarvo: joka päivälle sama odotettu määrä.</p>
      <table class="data-table">
        <thead><tr><th>Mittari</th><th>Malli</th><th>Keskiarvo</th></tr></thead>
        <tbody>
          <tr><td>Päivätason virhe (Poisson-devianssi)</td><td>${fmtNum(v.dailyDeviance.model, 3)}</td><td>${fmtNum(v.dailyDeviance.baseline, 3)}</td></tr>
          <tr><td>Kuukausimäärien keskivirhe</td><td>${fmtNum(v.monthlyMae.model, 2)}</td><td>${fmtNum(v.monthlyMae.baseline, 2)}</td></tr>
        </tbody>
      </table>
      <p>Malli on päivätasolla ${fmtPercent(devGain)} ja kuukausitasolla ${fmtPercent(maeGain)} tarkempi kuin keskiarvo. Päivätason ero on pieni, koska yksittäisen päivän hälytys on suurelta osin sattumaa: keskimäärin hälytys tulee noin joka kuudes päivä. Simulaatiokokeissa (30 eri simulaatiota) edes täsmälleen oikeat kertoimet paransivat päivätasoa keskimäärin vain noin 4 %, ja neljän vuoden datalla opetettu malli keskimäärin noin 3 %. Yksittäisen testivuoden tulos vaihtelee sattumalta tämän molemmin puolin. Ennusteen hyöty näkyy siksi parhaiten viikko- ja kuukausitasolla sekä syissä: mitkä tekijät nostavat riskiä.</p>
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
      <h3>Maastopaloindeksi</h3>
      <table class="data-table">
        <thead><tr><th>Taso</th><th>Päiviä</th><th>Paloja / 100 pv</th></tr></thead>
        <tbody>${wildfire}</tbody>
      </table>
      <p class="muted small">Koko aineisto. Korkeammilla tasoilla maastopaloja syttyy selvästi useammin.</p>
      <h3>Riskikartta</h3>
      <p>Testivuoden hälytykset osuivat ruutuihin, joille kartta antoi keskimääräistä suuremman riskin (log-pistemäärä ${fmtNum(v.spatialLogScoreVsUniform, 2)} tasaiseen jakaumaan verrattuna, positiivinen on parempi).</p>
    </article>`;
}

export function renderAbout(data: AppData): string {
  const m = data.meta;
  return `
  <section class="view">
    <header class="view-head">
      <p class="eyebrow">Tietoa</p>
      <h1>Tietoa pilotista</h1>
    </header>

    <article class="card prose notice-card">
      <h2>Simuloitu data</h2>
      <p>Tämä on Perttelin VPK:n (RVS492) pilotti. <strong>Kaikki luvut perustuvat simuloituun dataan</strong>, koska oikeaa hälytysdataa (PRONTO) ei ole käytettävissä. Simulaatio on kalibroitu todellisen kaltaiselle tasolle, noin 55-60 hälytystä vuodessa, mutta yksikään hälytys ei ole todellinen. Myös sää on simuloitu. Ennusteet eivät ole virallisia eivätkä korvaa hätäkeskuksen tai pelastuslaitoksen tietoja.</p>
    </article>

    <article class="card prose">
      <h2>Miten ennuste toimii</h2>
      <p>Jokaiselle tehtävätyypille on oma malli. Odotettu hälytysmäärä päivässä on</p>
      <p class="formula">perustaso x kuukausi x viikonpäivä x sääkertoimet</p>
      <p>ja kokonaisennuste on tehtävätyyppien summa. Kertoimet lasketaan historiasta. Kerroin 1,0 tarkoittaa tavallista tilannetta, 1,5 puolitoistakertaista.</p>
      <ul>
        <li><strong>Sää:</strong> liikenneonnettomuuksiin vaikuttavat liukkaus ja lumisade, rakennuspaloihin lämmitystarve ja jyrkästi kylmenevä sää (myös nokipalot hälytetään rakennuspaloina), maastopaloihin kuivuus, lämpö, tuuli ja lumipeite, vahingontorjuntaan myrsky ja rankkasade.</li>
        <li><strong>Vaikutuksen suunta on lukittu,</strong> kun se tiedetään varmasti: esimerkiksi kylmempi sää ei voi vähentää lämmityksestä johtuvia paloja eikä liukkaus liikenneonnettomuuksia. Malli päättää datasta vain, kuinka suuri vaikutus on.</li>
        <li><strong>Vähäinen data:</strong> pienen palokunnan hälytyksiä on vähän, joten kertoimia vedetään kohti keskiarvoa. Yksittäinen sattuma ei siksi tee päivästä "korkean riskin" päivää.</li>
        <li><strong>Riskitaso</strong> verrataan tavalliseen päivään: noin 80 % päivistä on matalia, 15 % kohonneita ja 5 % korkeita.</li>
        <li><strong>Syyt:</strong> Tänään-näkymä näyttää tekijät, jotka nostavat tai laskevat riskiä eniten, ja kuinka paljon.</li>
      </ul>
    </article>

    <article class="card prose">
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
      <p>Pisteet: 0-2 = 1, 3-4 = 2, 5-6 = 3, 7-8 = 4, vähintään 9 = 5. Myöhemmin indeksiä voidaan verrata Ilmatieteen laitoksen metsäpaloindeksiin.</p>
    </article>

    <article class="card prose">
      <h2>Riskikartta</h2>
      <p>Ruudun (1 km x 1 km) riski on hälytysten historiallinen tiheys tasoitettuna noin 1,5 km säteelle, kerrottuna valitun ajankohdan ja sään ennusteella. Simulaatiossa liikenneonnettomuudet painottuvat E18-moottoritielle ja kantatielle 52, rakennuspalot ja paloilmoitukset Inkereeseen ja Kaivolaan sekä maastopalot metsäalueille. Painotusalueet ovat likimääräisiä.</p>
    </article>

    ${validationSection(data.validation)}

    <article class="card prose">
      <h2>Tietosuoja</h2>
      <p>Sovellus ei käsittele henkilötietoja. Hälytyksistä tallennetaan vain aika, tehtävätyyppi, kiireellisyysluokka ja 1 km ruutu, ei osoitteita, nimiä tai tarkkoja kohteita. Kartalla näytetään vain mallin tasoitettu arvio, ei yksittäisiä hälytyksiä tai niiden määriä ruuduittain. Sivu toimii ilman taustapalvelinta, eikä se kerää tietoja käyttäjistä.</p>
    </article>

    <article class="card prose">
      <h2>Miten oikea data kytketään</h2>
      <ol>
        <li><strong>Hälytykset PRONTOsta</strong> CSV-muodossa: hälytysaika, tehtävätyyppi, kiireellisyysluokka (A-D) ja sijainti. Sijainti muunnetaan heti 1 km ruuduksi, eikä tarkkaa sijaintia tallenneta. PRONTOn tehtäväluokat yhdistetään sovelluksen kahdeksaan tyyppiin (esim. nokipalo kuuluu rakennuspaloihin).</li>
        <li><strong>Sää Ilmatieteen laitoksen avoimesta datasta:</strong> päivän keskilämpötila, ali- ja ylilämpötila, sademäärä, lumensyvyys ja keskituuli lähimmältä asemalta. Liukkaus päätellään lämpötilasta ja sateesta. Tänään-näkymän sää tulee tällöin säähavainnoista ja -ennusteesta.</li>
        <li><strong>Mallin opetus</strong> samalla komennolla kuin nyt. Se lukee vain datatiedostot, joten käyttöliittymään ei tarvita muutoksia. Simulaatiohuomautukset vaihtuvat datan lähteen mukaan.</li>
      </ol>
      <p class="muted small">Kaikki data noudattaa yhteistä skeemaa, joten simuloidun datan voi vaihtaa oikeaan tiedosto kerrallaan.</p>
    </article>

    <article class="card prose">
      <h2>Rajoitukset</h2>
      <ul>
        <li>Data on simuloitu. Oikea data voi poiketa simulaatiosta, ja kertoimet lasketaan silloin uudelleen.</li>
        <li>Viiden vuoden aineistossa joidenkin tekijöiden vaikutus ei erotu sattumasta (esim. viikonpäivät). Malli näyttää silloin tekijän neutraalina eikä keksi vaikutusta.</li>
        <li>Malli olettaa vuorokausirytmin samaksi joka päivä, eli esimerkiksi viikonloppuöiden erityispiirteet eivät vielä näy.</li>
        <li>Alueen rajaus, tiet ja taajamat ovat karkeita arvioita.</li>
      </ul>
    </article>

    <p class="footnote">Data: ${esc(m.source === 'simulated' ? 'simuloitu' : 'PRONTO')}, ${esc(m.startDate)}...${esc(m.endDate)}, ${m.incidentCount} hälytystä${m.seed !== null ? `, siemen ${m.seed}` : ''}. Skeeman versio ${m.schemaVersion}.</p>
    ${simulationNote(m)}
  </section>`;
}
