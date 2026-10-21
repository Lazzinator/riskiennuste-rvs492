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
- `scripts/build-model.ts`: lukee vain `public/data/*.json`, joten toimii myöhemmin oikealla datalla
