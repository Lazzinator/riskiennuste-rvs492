# Riskiennuste RVS492

Perttelin VPK:n pilottisovellus, joka ennustaa hälytyskuormaa, alueellista onnettomuusriskiä ja maastopaloriskiä.

**Huom:** Pilotti käyttää simuloitua dataa. Luvut eivät ole virallisia ennusteita.

Projektin tarkempi kuvaus ja työohjeet: [CLAUDE.md](CLAUDE.md).

## Kehitys

```sh
npm install
npm run generate-data   # simuloitu data hakemistoon public/data/ (siemen 492)
npm run build-model     # sovittaa mallit ja kirjoittaa model.json ja validation.json
npm run data            # molemmat edelliset
npm test                # Vitest
npm run dev             # kehityspalvelin
npm run build           # tyyppitarkistus ja tuotantoversio hakemistoon dist/
```

Tänään-näkymän päivän voi vaihtaa esittelyä varten osoitteessa: `?pvm=2026-01-14`.
Riskikartan tarkistustila `?geo=1#/kartta` piirtää simulaation painotusalueet (aluerajaus, tiet,
taajamat) kartalle, jotta niitä voi verrata oikeaan karttaan.

Rakenne:

- `src/data/schema.ts`: yhteinen dataskeema ja validointi (simuloitu ja myöhemmin oikea data)
- `src/data/geo.ts`: Perttelin karkea aluerajaus, tiet, taajamat ja 1 km ruudukko
- `src/data/generator.ts`: deterministinen sää- ja hälytyssimulaatio
- `scripts/generate-data.ts`: kirjoittaa datan tiedostoihin `public/data/*.json`
- `src/model/features.ts`: mallin selittäjät (liukkaus, pakkanen, kuivuus, tuuli...) luokkina
- `src/model/alarmModel.ts`: hälytysmalli tehtävätyypeittäin, ennuste, riskitaso ja syyt
- `src/model/wildfire.ts`: maastopaloriski-indeksi 1-5
- `src/model/spatialModel.ts`: riskikartan ruutukohtainen tiheys
- `src/model/validation.ts`: viimeinen vuosi testijoukkona, vertailu pelkkään keskiarvoon
- `src/app/todayView.ts`: Tänään-näkymän luvut ja tekstit (puhdas funktio, testattava)
- `src/app/views/today.ts`, `src/main.ts`, `src/style.css`: käyttöliittymä
- `src/app/mapView.ts`, `src/app/views/map.ts`: riskikartta (Leaflet, OpenStreetMap-tausta, 1 km ruudut)
- `src/app/timingView.ts`, `src/app/views/timing.ts`: Ajankohdat (viikonpäivä x tunti, kuukausijakauma, Chart.js)
- `src/app/views/about.ts`: Tietoa pilotista, validointitulokset tiedostosta `validation.json`
- `public/data/weather-current.json`: simuloitu "nykysää" 2026-2028, jatkaa historiaa katkeamatta.
  Oikeassa versiossa tilalle tulevat Ilmatieteen laitoksen havainnot ja ennuste.
- `scripts/build-model.ts`: lukee vain `public/data/*.json`, joten toimii myöhemmin oikealla datalla

## Julkaisu (GitHub Pages)

Julkaisu tapahtuu automaattisesti GitHub Actionsilla (`.github/workflows/deploy.yml`), kun
`main`-haaraan tulee muutoksia. Työnkulku ajaa tyyppitarkistuksen, testit ja buildin, ja sivu
julkaistaan vain, jos kaikki menevät läpi. Julkaisun voi käynnistää myös käsin Actions-välilehdeltä.
Pull requesteille ajetaan sama tarkistus ilman julkaisua (`.github/workflows/ci.yml`).

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

Sivulla on `noindex`-merkintä, jottei simuloitua pilottia luulla hakukoneissa oikeaksi
ennusteeksi. Poista se `index.html`-tiedostosta, kun käytössä on oikea data.
