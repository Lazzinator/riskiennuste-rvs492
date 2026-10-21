# Riskiennuste RVS492

Perttelin VPK:n pilottisovellus, joka ennustaa hälytyskuormaa, alueellista onnettomuusriskiä ja maastopaloriskiä.

**Huom:** Pilotti käyttää simuloitua dataa. Luvut eivät ole virallisia ennusteita.

Projektin tarkempi kuvaus ja työohjeet: [CLAUDE.md](CLAUDE.md).

## Kehitys

```sh
npm install
npm run generate-data   # simuloitu data hakemistoon public/data/ (siemen 492)
npm test                # Vitest
npm run dev             # kehityspalvelin
npm run build           # tyyppitarkistus ja tuotantoversio hakemistoon dist/
```

Rakenne:

- `src/data/schema.ts`: yhteinen dataskeema ja validointi (simuloitu ja myöhemmin oikea data)
- `src/data/geo.ts`: Perttelin karkea aluerajaus, tiet, taajamat ja 1 km ruudukko
- `src/data/generator.ts`: deterministinen sää- ja hälytyssimulaatio
- `scripts/generate-data.ts`: kirjoittaa datan tiedostoihin `public/data/*.json`
