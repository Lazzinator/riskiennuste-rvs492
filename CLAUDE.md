# Riskiennuste RVS492 (pilotti)

Tämä tiedosto on projektin pysyvä ohje Claudelle. Lue se ennen jokaista työvaihetta.

## Mikä tämä on

Perttelin VPK:n (Salo, yksikkö RVS492) jäsenille tarkoitettu selainsovellus, joka ennustaa
1. **hälytyskuormaa**: milloin hälytyksiä todennäköisimmin tulee (kuukausi, viikonpäivä, kellonaika, sää),
2. **alueellista riskiä**: missä Perttelin alueella onnettomuudet todennäköisimmin sattuvat (riskikartta),
3. **maastopaloriskiä**: päivittäinen riski sään ja kosteuden perusteella.

Kyseessä on **pilotti simuloidulla datalla**. Oikeaa PRONTO-dataa ei ole saatavilla, joten data generoidaan realistisesti. Sovelluksen pitää näyttää selvästi jokaisella sivulla, että luvut perustuvat simulaatioon eivätkä ole virallisia ennusteita. Rakenne tehdään niin, että oikean datan voi myöhemmin vaihtaa tilalle muuttamatta käyttöliittymää.

Käyttäjät: palokunnan jäsenet, pääosin puhelimella. Kieli: suomi.

## Periaatteet

- **Läpinäkyvä malli, ei musta laatikko.** Jäsenen pitää ymmärtää miksi riski on korkea ("perjantai-ilta + liukas keli"). Jokaisen ennusteen yhteydessä näytetään tärkeimmät syyt.
- **Ei henkilötietoja.** Ei nimiä, osoitteita tai tarkkoja kohteita. Riskikartta ruutuina (esim. 500 m tai 1 km), ei pisteinä.
- **Ei taustapalvelinta pilotissa.** Staattinen sivu, joka toimii GitHub Pagesissa ja jonka voi myöhemmin siirtää perttelinvpk.fi-domainille.
- **Mobiili ensin.** Toimii 375 px leveydellä, isot luettavat luvut.
- Teksteissä ei käytetä pitkiä ajatusviivoja (—). Käytä pistettä, pilkkua tai kaksoispistettä.

## Tekninen pino

- Vite + TypeScript (ei raskasta frameworkia; vanilla TS tai kevyt Preact riittää)
- Kartta: Leaflet + OpenStreetMap-taustakartta
- Kaaviot: Chart.js
- Testit: Vitest
- Julkaisu: GitHub Actions -> GitHub Pages

## Data (simuloitu)

Generaattori `scripts/generate-data.ts` tuottaa tiedostot hakemistoon `public/data/`.

Kalibrointi (todellisen kaltainen taso):
- Noin 55-60 hälytystä vuodessa, 5 vuoden historia (yhteensä noin 280).
- Tehtävätyypit ja karkeat osuudet: ensivaste/avunanto, liikenneonnettomuus, rakennuspalo, maastopalo, muu tulipalo, vahingontorjunta, automaattinen paloilmoitus, eläinpelastus/muu.
- Kiireellisyysluokat A, B, C, D.
- Ajallinen vaihtelu: maastopalot keväällä ja kesällä (huippu huhti-kesäkuu), liikenneonnettomuudet liukkailla keleillä ja ilta-aikaan, rakennuspalot talvella ja lämmityskaudella, viikonloppuina ja iltaisin enemmän.
- Säädata simuloidaan päivätasolla (lämpötila, sademäärä, lumi, tuuli, liukkaus) suomalaisen ilmaston mukaan, jotta malli voi käyttää säätä selittäjänä.
- Alue: Pertteli, Salo (keskipiste noin 60.42 N, 23.27 E, tarkista). Riskiä painotetaan teille (esim. Turku-Helsinki-moottoritie ja valtatie lähellä), taajamiin (Inkere, Kaivola) ja metsäalueille maastopalojen osalta. Määrittele painotus yksinkertaisina polygoneina tai ruutuina, ei tarvita ulkoista paikkatietoa.
- Generaattori on deterministinen (siemenluku), jotta tulokset toistuvat.

Kaikki data noudattaa yhtä skeemaa (`src/data/schema.ts`), jotta oikean datan voi tuoda myöhemmin CSV:stä samaan muotoon.

## Malli

Aloita yksinkertaisella ja selitettävällä:
- Hälytysintensiteetti = perustaso x kuukausikerroin x viikonpäiväkerroin x tuntikerroin x sääkertoimet (Poisson-tyyppinen malli, kertoimet estimoidaan historiasta).
- Tehtävätyypeittäin oma malli, kokonaisennuste on summa.
- Riskikartta: historiallinen tiheys ruuduittain, tasoitettuna, kerrottuna ajankohdan ja sään kertoimilla.
- Maastopaloriski: yksinkertainen indeksi (päiviä edellisestä sateesta, lämpötila, tuuli, kuukausi), skaalattu 1-5. Myöhemmin voidaan verrata Ilmatieteen laitoksen metsäpaloindeksiin.
- Validointi: pidä viimeinen vuosi testijoukkona ja raportoi malli vs. pelkkä keskiarvo.

## Näkymät

1. **Tänään / tämä viikko**: odotettu hälytysmäärä, riskitaso (matala/kohonnut/korkea), tärkeimmät syyt, maastopaloriski.
2. **Riskikartta**: ruudukko Leafletissa, valittavissa tehtävätyyppi ja ajankohta.
3. **Ajankohdat**: lämpökartta viikonpäivä x tunti, kuukausijakauma.
4. **Tietoa pilotista**: miten malli toimii, että data on simuloitu, miten oikea data voidaan kytkeä.

Ilme: tumma teema, palokunnan punainen korostusvärinä, selkeä ja rauhallinen.

## Vaiheet

1. Projektipohja, skeema, datageneraattori ja sen testit.
2. Malli ja validointi (testeillä).
3. Käyttöliittymä: Tänään-näkymä.
4. Riskikartta.
5. Ajankohdat-näkymä ja Tietoa-sivu.
6. GitHub Pages -julkaisu.

Tee yksi vaihe kerrallaan, aja testit, committaa ja kerro lyhyesti mitä valmistui ennen seuraavaa.
