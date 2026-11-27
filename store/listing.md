# Store-teksten CashbackRadar

Teksten om te plakken in het Chrome Web Store Developer Dashboard en Microsoft Partner Center.
Taal: Nederlands. Categorie: **Shopping** (Chrome) / **Shopping** (Edge).

## Afbeeldingen in deze map

| Bestand | Waar | Formaat |
| --- | --- | --- |
| `../extension/icons/active-128.png` | Chrome: store-icoon (zit ook in het pakket) | 128 × 128 |
| `logo-300.png` | Edge: extensielogo | 300 × 300 |
| `screenshot-1-beste-deal.png` | Chrome en Edge: screenshot 1 | 1280 × 800 |
| `screenshot-2-vergelijken.png` | Chrome en Edge: screenshot 2 | 1280 × 800 |
| `screenshot-3-geen-cashback.png` | Chrome en Edge: screenshot 3 | 1280 × 800 |
| `promo-440x280.png` | Chrome: kleine promotegel (verplicht); Edge: small promotional tile | 440 × 280 |
| `promo-1400x560.png` | Chrome: marqueetegel; Edge: large promotional tile (beide optioneel) | 1400 × 560 |

De screenshots tonen de echte popup met echte bedragen uit de lijsten van 27 november 2026,
in een nagebootst browservenster.

## Korte beschrijving

Komt uit `manifest.json` (maximaal 132 tekens):

> Ziet of de site die je bezoekt cashback heeft bij ShopBuddies of CashbackXL, en waar die het hoogst is. Onofficieel.

## Uitgebreide beschrijving

```
Zie bij elke webwinkel meteen of je cashback krijgt via ShopBuddies of CashbackXL, en bij welke van de twee het meest.

Onofficieel: CashbackRadar is niet verbonden aan ShopBuddies of CashbackXL.

HOE HET WERKT
• Grijs icoon: geen cashback bekend voor deze site.
• Groen icoon met percentage of bedrag: de hoogste cashback van de twee aanbieders.
• Klik op het icoon voor de details: de beste deal bovenaan met een knop naar die aanbieder, daaronder de andere aanbiedingen.
• Per aanbieder zet je hem aan of uit.

Cashback telt alleen als je via de aanbieder naar de winkel doorklikt. CashbackRadar voegt zelf geen links of codes toe aan de sites die je bezoekt; het opent de aanbieder alleen als jij op de knop klikt.

PRIVACY
De adressen van je tabbladen worden alleen in je browser vergeleken met de winkellijsten. Ze worden nergens naartoe gestuurd en niet bewaard. Geen account, geen tracking, geen advertenties.

Om de lijsten actueel te houden haalt de extensie de openbare winkellijsten van shopbuddies.nl en cashbackxl.nl op: de eerste keer volledig, daarna elke minuut één pagina.

Broncode: https://github.com/micheltol/CashbackRadar
```

## Links

- Homepage / website: `https://github.com/micheltol/CashbackRadar`
- Support: `https://github.com/micheltol/CashbackRadar/issues`
- Privacybeleid: `https://github.com/micheltol/CashbackRadar/blob/main/PRIVACY.md`

## Chrome: tabblad Privacy

**Single purpose**

```
Laat bij de website die je bezoekt zien of er cashback is via ShopBuddies of CashbackXL, en bij welke aanbieder die het hoogst is.
```

**Rechtvaardiging per permissie**

`tabs`
```
Nodig om het adres van het actieve tabblad te lezen, zodat het domein lokaal met de winkellijsten kan worden vergeleken en het icoon per tabblad groen (cashback) of grijs (geen cashback) wordt. Het adres verlaat de browser niet en wordt niet opgeslagen.
```

`storage`
```
Slaat de winkellijsten van ShopBuddies en CashbackXL en de instellingen (welke aanbieders aan staan) lokaal op, zodat ze niet bij elke start opnieuw opgehaald hoeven te worden.
```

`alarms`
```
Ververst de winkellijsten geleidelijk: elke minuut één pagina per aanbieder, zodat de bedragen actueel blijven zonder een reeks verzoeken achter elkaar naar die sites.
```

Host-permissies (`https://shopbuddies.nl/*`, `https://www.cashbackxl.nl/*`)
```
Nodig om de openbare winkellijsten met cashbackpercentages van deze twee sites op te halen. De extensie benadert geen andere sites.
```

**Remote code:** Nee, ik gebruik geen remote code. Alle JavaScript zit in het pakket.

**Gegevensgebruik** — aanvinken:
- Web browsing activity (alleen lokaal verwerkt, zie privacybeleid)

En de drie verklaringen aanvinken: geen verkoop aan derden, geen gebruik buiten het doel, geen gebruik voor kredietwaardigheid of leningen.

## Edge: Notes for certification

```
CashbackRadar shows whether the current website offers cashback via the Dutch cashback sites ShopBuddies or CashbackXL. No account or login is needed.

How to test:
1. Install the extension and wait about one minute: on first install it downloads the public shop lists (ShopBuddies ~10 s, CashbackXL ~1 min because that site is rate-limited).
2. Open https://www.hema.nl/ or https://www.coolblue.nl/. The toolbar icon turns green with a percentage badge.
3. Click the icon: the popup shows the best deal and the other offers.
4. Open a site without cashback (e.g. https://www.wikipedia.org/): the icon stays grey.

The tabs permission is only used to read the active tab's URL and compare its domain locally with the shop lists. No browsing data leaves the browser.
```

## Edge: zoektermen (maximaal 7)

cashback, ShopBuddies, CashbackXL, geld terug, korting, webwinkel, besparen
