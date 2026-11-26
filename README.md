# CashbackRadar

Onofficiële Edge-extensie die bij elke site die je bezoekt laat zien of er cashback is via
[ShopBuddies](https://shopbuddies.nl/) of [CashbackXL](https://www.cashbackxl.nl/), en bij
welke van de twee die het hoogst is. De winkellijsten worden één keer volledig opgehaald en
daarna de hele dag door in kleine delen ververst. Ze worden lokaal met het domein van je tab
vergeleken; welke sites je bezoekt verlaat je browser niet.

Dit is geen product van ShopBuddies of CashbackXL. Geen van beide heeft een officiële API:
de extensie gebruikt wat hun eigen sites tonen, en dat kan zonder aankondiging veranderen.

## Installeren in Edge

1. Open `edge://extensions`.
2. Zet links **Ontwikkelaarsmodus** aan.
3. Klik **Uitgepakte extensie laden** en kies de map `extension` uit dit project.
4. Klik op het puzzelstukje in de werkbalk en zet de extensie vast (oogje).

Had je de extensie al geladen, klik dan op de extensiekaart op **Opnieuw laden**. De map moet
blijven staan; Edge laadt de extensie daar elke keer vandaan.

Na de eerste keer laden haalt de extensie de lijsten volledig op: ShopBuddies in ongeveer tien
seconden, CashbackXL in ongeveer een minuut (die site staat maar een beperkt aantal verzoeken
toe). Bij opnieuw laden blijven de opgehaalde lijsten staan.

## Wat je ziet

- **Grijs icoon:** geen cashback bekend voor deze site.
- **Groen icoon met percentage of bedrag:** de hoogste cashback van de twee aanbieders. Het icoon rondt naar beneden af; de popup toont het exacte bedrag.
- **Groen icoon met `10×`:** meerdere aanbiedingen op dit domein die even goed passen (bijvoorbeeld verzekeringen).
- **Popup:** bovenaan de beste deal met een knop naar die aanbieder, daaronder de andere aanbiedingen, elk met een eigen link. Cashback telt alleen als je via de aanbieder doorklikt.
- **Onderaan de popup:** per aanbieder een vinkje om hem aan of uit te zetten, met het aantal winkels, het moment van het laatst ververste deel en hoe ver de lopende ronde is (`deel 12/29`).
- **Lijsten vernieuwen:** haalt alles in één keer opnieuw op. Normaal is dat niet nodig.

### Geleidelijk verversen

Elk kwartier haalt de extensie één pagina per aanbieder op en werkt daarmee de lijst bij. Een
ronde door alle pagina's (27 bij ShopBuddies, 29 bij CashbackXL) duurt zo ongeveer zeven uur
dat de browser open staat. Een site krijgt dus nooit een reeks verzoeken achter elkaar.

- Een gewijzigd bedrag of een nieuwe winkel zie je zodra de pagina waar hij op staat aan de beurt is geweest: binnen één ronde.
- Een winkel die bij de aanbieder verdwenen is, gaat uit de lijst nadat hij twee rondes achter elkaar niet meer is gezien. Eén ronde is te weinig: als de lijst tijdens een ronde verschuift, kan een winkel een keer tussen twee pagina's door glippen.
- Mislukt een stap, dan wacht de extensie een half uur (een uur als de site verzoeken weigert) en probeert dezelfde pagina opnieuw. Blijft het misgaan, dan loopt de wachttijd op tot zes uur. De bestaande lijst blijft al die tijd bruikbaar.
- Ziet een ronde veel minder winkels dan er waren, dan wordt er niets verwijderd en begint de ronde opnieuw.

Het tempo staat als `STEP_MINUTES` bovenaan `extension/background.js`. Eén stap direct zetten,
om het te zien werken, kan in de DevTools van de popup (rechtsklik op het icoon,
**Pop-upvenster inspecteren**, tabblad Console):

```js
await chrome.runtime.sendMessage({ type: 'step' })
```

### Hoe de beste deal wordt gekozen

- Procent tegen procent of euro tegen euro: het hoogste bedrag wint.
- Gelijk: ShopBuddies heeft de voorkeur.
- Procent tegenover een vast bedrag is niet te vergelijken; dan staat ShopBuddies bovenaan en meldt de popup dat.
- CashbackXL geeft bij twee winkels (Coolblue en Center Parcs) geen geld maar tegoed voor een voucher. Dat telt mee op het getal, maar staat er duidelijk bij.
- CashbackXL geeft bij twaalf winkels (vooral verzekeringen) spaarpunten. Die zijn niet met geld te vergelijken; het icoon toont dan `pnt`.
- Heeft de ene aanbieder één duidelijke aanbieding en de andere meerdere gelijkwaardige (tien verzekeringen op één domein), dan staat de duidelijke bovenaan.

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `extension/lib/providers/shopbuddies.js` | ShopBuddies: JSON-lijst omzetten naar regels. |
| `extension/lib/providers/cashbackxl.js` | CashbackXL: lijst- en detailpagina's lezen, domeinen bijleren. |
| `extension/lib/providers/index.js` | De aanbieders in voorkeursvolgorde, en de instellingen. |
| `extension/lib/domains.js` | Domeinen normaliseren, trackingdomeinen uitsluiten. |
| `extension/lib/merchant-index.js` | Opzoektabel bouwen en zoeken. Hier voeg je andere matchpatronen toe. |
| `extension/lib/compare.js` | Resultaten van de aanbieders samenvoegen en de beste kiezen. |
| `extension/lib/format.js` | Cashback en badge weergeven. |
| `extension/lib/incremental.js` | Boekhouding van het geleidelijk verversen: rondes, pagina's verwerken, pauzes. |
| `extension/background.js` | Eerste volledige lijst, daarna elk kwartier een stap; icoon en badge per tab. |
| `extension/popup/` | De popup. |
| `extension/data/cashbackxl-domains.json` | Domein per CashbackXL-winkel, meegeleverd (zie hieronder). |
| `data/merchants-nl.json` | Volledige ruwe ShopBuddies-lijst voor eigen analyse. |
| `data/cashbackxl-nl.json` | Volledige CashbackXL-lijst voor eigen analyse, met domein en tarieven. |
| `tools/fetch-merchants.mjs` | Ververst `data/merchants-nl.json` (tien seconden). |
| `tools/fetch-cashbackxl.mjs` | Ververst `data/cashbackxl-nl.json` en het meegeleverde domeinbestand (ruim een half uur). |
| `tools/make-icons.mjs` | Tekent de iconen opnieuw. |
| `test/` | Tests; gebruiken de echte lijsten als die er zijn. |

```powershell
node --test
```

```powershell
node tools/fetch-merchants.mjs
```

```powershell
node tools/fetch-cashbackxl.mjs
```

Een los adres controleren kan via `popup/popup.html?url=https://surfshark.com/` op het
`chrome-extension://`-adres van de extensie.

## Waar de gegevens vandaan komen

**ShopBuddies** levert alle winkels als JSON (27 pagina's van 100 winkels), met de website,
aliasdomeinen en cashback per winkel. Elke pagina geeft een bladwijzer voor de volgende mee;
die blijft geldig, zodat de extensie een kwartier later verder kan waar ze was.

**CashbackXL** heeft geen JSON-lijst. De winkels staan op 29 lijstpagina's met naam, hoogste
cashback en aantal aanbiedingen; het domein van een winkel staat alleen op zijn eigen
detailpagina. Alle detailpagina's ophalen zou ruim 1.400 verzoeken zijn, en de site weigert
verzoeken als het te snel gaat (status 429). Daarom:

- de domeinen zitten in `extension/data/cashbackxl-domains.json`, gemaakt met `tools/fetch-cashbackxl.mjs`;
- de extensie haalt alleen de 29 lijstpagina's op voor de actuele bedragen: de eerste keer achter elkaar met anderhalve seconde ertussen, daarna één pagina per kwartier;
- van winkels die nog niet in het bestand staan haalt de extensie zelf de detailpagina op en onthoudt het domein: hooguit drie per stap (twintig bij een volledige verversing).

## Hoe het matchen werkt

Van elk winkeladres gaat `www.` af, en adressen zonder `https://` worden ook geaccepteerd. Bij
een bezoek wordt eerst het volledige domein gezocht en daarna steeds een niveau hoger
(`m.hema.nl` vindt `hema.nl`). Staat er een pad in het winkeladres
(`coolblue.nl/energiecontracten`, `anwb.nl/creditcard`), dan komt die winkel bovenaan zodra je
op dat pad bent.

Winkels zonder bruikbaar domein worden niet herkend. Bij ShopBuddies zijn dat er ongeveer 490
van de 2.630, veel fysieke zaken. Bij CashbackXL 39 van de 1.426, vooral cadeaukaarten.
Achthonderd domeinen staan bij beide aanbieders.
