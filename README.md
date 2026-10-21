# Riskiennuste RVS492

Perttelin VPK:n pilottisovellus, joka ennustaa hälytyskuormaa, alueellista onnettomuusriskiä ja maastopaloriskiä.

**Huom:** Ennusteet ovat suuntaa antavia eivätkä virallisia.

Projektin tarkempi kuvaus ja työohjeet: [CLAUDE.md](CLAUDE.md).

## Data

- **Hälytykset:** RVS492:n PRONTO-ote 2021-2026. Ote sisältää osoitteita, koordinaatteja ja
  tietoja osallisista, joten **otetta ei tallenneta repositorioon** (`.gitignore` estää `*.txt`).
  Tuonti julkaisee vain hälytysajan tunnin tarkkuudella, tehtävätyypin ja kiireellisyyden
  (`public/data/incidents.json`) sekä riskikartan tasoitetun tiheyden (`public/data/spatial.json`).
  Testi `tests/published-data.test.ts` varmistaa, ettei julkaistuissa tiedostoissa ole sijainteja.
- **Sää:** Ilmatieteen laitoksen avoin data (CC BY 4.0): päivähavainnot lähimmiltä asemilta,
  tuulen tuntiarvot ja pistekohtainen ennuste. Haetaan GitHub Actionsissa joka yö. Jos haku
  epäonnistuu, malli opetetaan ilman sääselittäjiä eikä sivu näytä säätä.
- **Simulaattori** (`src/data/generator.ts`) on kalibroitu oikean datan tasoon. Sitä käytetään
  testeissä ja mallin tarkistamisessa (`npm run generate-data` kirjoittaa hakemistoon `data-sim/`).

## Kehitys

```sh
npm install
npm run import-pronto -- polku/Pronto_492.txt   # uusi PRONTO-ote (ei tallenneta repositorioon)
npm run fetch-weather   # säätiedot Ilmatieteen laitokselta (vaatii verkkoyhteyden)
npm run build-model     # sovittaa mallit ja kirjoittaa model.json ja validation.json
npm test                # Vitest
npm run dev             # kehityspalvelin
npm run build           # tyyppitarkistus ja tuotantoversio hakemistoon dist/
```

Uuden PRONTO-otteen päivitys: aja `import-pronto` ja `build-model`, aja testit ja committaa
`public/data/`. Julkaisu hakee sään ja opettaa mallin uudelleen automaattisesti.

Tänään-näkymän päivän voi vaihtaa esittelyä varten osoitteessa: `?pvm=2026-01-14`.

Rakenne:

- `src/data/schema.ts`: yhteinen dataskeema ja validointi
- `src/data/pronto.ts`, `scripts/import-pronto.ts`: PRONTO-otteen jäsennys, tehtävätyyppien yhdistäminen, tuonti
- `src/data/fmi.ts`, `scripts/fetch-weather.ts`: Ilmatieteen laitoksen havainnot ja ennuste päiväsääksi
- `src/data/weather.ts`: sademäärästä ja lämpötilasta johdetut suureet (kuivat päivät, liukkaus, lumi)
- `src/data/geo.ts`: ruudukko ja ruutujen kuvaukset; simulaation painotusalueet
- `src/data/generator.ts`: deterministinen sää- ja hälytyssimulaatio
- `src/model/features.ts`: mallin selittäjät (liukkaus, lämmitystarve, kuivuus, tuuli...) luokkina
- `src/model/alarmModel.ts`: hälytysmalli tehtävätyypeittäin, ennuste, riskitaso ja syyt
- `src/model/wildfire.ts`: maastopaloriski-indeksi 1-5
- `src/model/spatialModel.ts`: riskikartan ruutukohtainen tiheys
- `src/model/validation.ts`: viimeiset 12 kk testijoukkona, vertailu pelkkään keskiarvoon
- `scripts/build-model.ts`: opettaa mallit tiedostoista `public/data/*.json`
- `src/app/`: käyttöliittymä (Tänään, Riskikartta, Ajankohdat, Tietoa)

## Julkaisu (GitHub Pages)

Julkaisu tapahtuu automaattisesti GitHub Actionsilla (`.github/workflows/deploy.yml`), kun
`main`-haaraan tulee muutoksia, sekä joka yö (tuore sää ja ennuste). Työnkulku hakee sään, opettaa
mallin, ajaa tyyppitarkistuksen, testit ja buildin, ja sivu julkaistaan vain, jos ne menevät läpi.
Julkaisun voi käynnistää myös käsin Actions-välilehdeltä. Pull requesteille ajetaan sama
tarkistus ilman julkaisua (`.github/workflows/ci.yml`).

Kertaluonteinen asetus: repositorion **Settings > Pages > Build and deployment > Source:
GitHub Actions**. Sivu tulee osoitteeseen `https://<käyttäjä>.github.io/riskiennuste-rvs492/`.

Sivu käyttää suhteellisia polkuja (`base: './'`) ja hash-reititystä (`#/kartta`), joten se toimii
sekä GitHub Pagesin alipolussa että omalla domainilla ilman palvelinasetuksia.

### Siirto omalle domainille (esim. perttelinvpk.fi)

1. Lisää tiedosto `public/CNAME`, jonka sisältö on domain, esim. `riski.perttelinvpk.fi`.
2. Lisää domainin DNS:ään CNAME-tietue, joka osoittaa osoitteeseen `<käyttäjä>.github.io`.
3. Aseta sama domain kohtaan Settings > Pages > Custom domain ja ota käyttöön Enforce HTTPS.

Vaihtoehtoisesti `dist/`-hakemiston sisällön voi kopioida mille tahansa staattiselle
palvelimelle sellaisenaan, esim. alihakemistoon perttelinvpk.fi-sivustolla.

Sivulla on `noindex`-merkintä, jottei pilottia löydetä hakukoneista ja luulla viralliseksi
ennusteeksi. Sen voi poistaa `index.html`-tiedostosta, kun sivu otetaan laajemmin käyttöön.
