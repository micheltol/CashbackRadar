// Draait met: node --test
// Gebruikt de echte lijsten in data/ als die er zijn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hostFromUrl, candidateHosts, isTrackingHost } from '../extension/lib/domains.js';
import { buildIndex, lookup } from '../extension/lib/merchant-index.js';
import { formatCashback, badgeText, badgeFor } from '../extension/lib/format.js';
import { combine, compareAmounts } from '../extension/lib/compare.js';
import { fetchAllMerchants } from '../extension/lib/api.js';
import { shopbuddies, toEntries as shopbuddiesEntries } from '../extension/lib/providers/shopbuddies.js';
import {
  cashbackxl,
  parseAmount,
  parseListPage,
  parseDetailPage,
  domainRecord,
  toEntries as cashbackxlEntries,
} from '../extension/lib/providers/cashbackxl.js';
import { PROVIDERS, normalizeSettings } from '../extension/lib/providers/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...parts) => {
  const file = join(root, ...parts);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const shopbuddiesData = readJson('data', 'merchants-nl.json');
const cashbackxlData = readJson('data', 'cashbackxl-nl.json');
const cashbackxlSeed = readJson('extension', 'data', 'cashbackxl-domains.json');

const amount = (value, amountType) => ({ amount: { value, currency: 'EUR', scalingFactor: 2 }, amountType });
const pct = (value, extra = {}) => ({ type: 'PERCENTAGE', value, ...extra });
const eur = (value) => ({ type: 'FIXED', value });
const labelOf = (id) => PROVIDERS.find((provider) => provider.id === id).label;

test('hostFromUrl normaliseert en wijst af', () => {
  assert.deepEqual(hostFromUrl('https://www.Bol.com/nl/p/iets/'), { host: 'bol.com', path: '/nl/p/iets' });
  assert.deepEqual(hostFromUrl('kpn.com'), { host: 'kpn.com', path: '' });
  assert.deepEqual(hostFromUrl('unive.nl/opstalverzekering'), { host: 'unive.nl', path: '/opstalverzekering' });
  assert.deepEqual(hostFromUrl('www.minecraft.com'), { host: 'minecraft.com', path: '' });
  assert.equal(hostFromUrl('Herbs by Sonja'), null);
  assert.equal(hostFromUrl('timarco-nl'), null);
  assert.equal(hostFromUrl(''), null);
  assert.equal(hostFromUrl(undefined), null);
  assert.equal(hostFromUrl('edge://extensions'), null);
  assert.equal(hostFromUrl('chrome-extension://abc/popup.html'), null);
  assert.equal(hostFromUrl('file:///C:/x.html'), null);
  assert.equal(hostFromUrl('http://localhost:3000/'), null);
  assert.equal(hostFromUrl('https://192.168.1.1/'), null);
});

test('candidateHosts loopt omhoog tot twee labels', () => {
  assert.deepEqual(candidateHosts('m.shop.voorbeeld.nl'), ['m.shop.voorbeeld.nl', 'shop.voorbeeld.nl', 'voorbeeld.nl']);
  assert.deepEqual(candidateHosts('bol.com'), ['bol.com']);
});

test('trackingdomeinen worden herkend', () => {
  assert.equal(isTrackingHost('awin1.com'), true);
  assert.equal(isTrackingHost('gstar.prf.hn'), true);
  assert.equal(isTrackingHost('che01.safelinks.protection.outlook.com'), true);
  assert.equal(isTrackingHost('bol.com'), false);
  assert.equal(isTrackingHost('notawin1.com'), false);
});

test('ShopBuddies: winkels worden regels, en lookup vindt ze', () => {
  const entries = shopbuddiesEntries([
    { id: '1', name: 'Winkel', websiteUrl: 'https://www.winkel.nl/', countrySlugs: { NL: 'winkel-cashback' }, cashbackAmount: amount(400, 'PERCENTAGE'), dealCount: 4 },
    { id: '2', name: 'Winkel Energie', websiteUrl: 'https://www.winkel.nl/energie', cashbackAmount: amount(2500, 'FIXED'), dealCount: 22 },
    { id: '3', name: 'Alias', websiteUrl: '', websiteUrls: ['alias.com'], cashbackAmount: amount(750, 'PROGRESSIVE_PERCENTAGE') },
    { id: '4', name: 'Via netwerk', websiteUrl: 'https://www.awin1.com/cread.php?s=1', websiteUrls: ['echt.nl'] },
    { id: '5', name: 'Alleen netwerk', websiteUrl: 'https://www.awin1.com/cread.php?s=2' },
    { id: '6', name: 'Fysiek', websiteUrl: '' },
    { id: '7', name: 'Per land', websiteUrl: 'https://www.land.com/', countryWebsiteUrls: { NL: 'https://www.land.nl/?tag=x', DE: 'https://www.awin1.com/x' } },
  ]);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries[2].cashback, pct(7.5, { upTo: true }));

  const index = buildIndex(entries, 7);
  assert.equal(index.total, 7);

  // Zonder pad wint de winkel voor het hele domein, ook al heeft de andere meer deals.
  assert.deepEqual(lookup(index, 'https://www.winkel.nl/product/1').matches.map((m) => m.name), ['Winkel', 'Winkel Energie']);
  // Op het specifieke pad wint de specifieke winkel.
  const onPath = lookup(index, 'https://www.winkel.nl/energie/vergelijken');
  assert.deepEqual(onPath.matches.map((m) => m.name), ['Winkel Energie', 'Winkel']);
  assert.equal(onPath.matches[0].pathMatch, true);
  // "/energiezuinig" valt niet onder "/energie".
  assert.equal(lookup(index, 'https://www.winkel.nl/energiezuinig').matches[0].name, 'Winkel');

  assert.equal(lookup(index, 'https://shop.winkel.nl/').host, 'winkel.nl');
  assert.equal(lookup(index, 'https://alias.com/x').matches[0].name, 'Alias');
  assert.equal(lookup(index, 'https://echt.nl/').matches[0].name, 'Via netwerk');
  assert.equal(lookup(index, 'https://www.awin1.com/cread.php?s=1'), null);
  assert.equal(lookup(index, 'https://www.land.nl/dp/1').matches[0].name, 'Per land');
  assert.equal(lookup(index, 'https://www.land.com/').matches[0].name, 'Per land');
  assert.equal(lookup(index, 'https://nietbekend.nl/'), null);
  assert.equal(lookup(index, 'edge://newtab'), null);
  assert.equal(lookup(null, 'https://winkel.nl/'), null);

  assert.equal(shopbuddies.entryUrl(entries[0]), 'https://shopbuddies.nl/cashback/winkel-cashback');
  assert.equal(shopbuddies.entryUrl(entries[1]), 'https://shopbuddies.nl/cashback/2');
});

test('cashback wordt goed weergegeven', () => {
  assert.equal(formatCashback(pct(1.75)), '1,75%');
  assert.equal(formatCashback(pct(4)), '4%');
  assert.equal(formatCashback(pct(7.5, { upTo: true })), 'tot 7,5%');
  assert.equal(formatCashback(eur(25)), '€ 25');
  assert.equal(formatCashback(eur(2.5)), '€ 2,50');
  assert.equal(formatCashback({ ...eur(90), upTo: true }), 'tot € 90');
  assert.equal(formatCashback(null), 'cashback');

  assert.equal(badgeText(pct(1.75)), '1,7%');
  assert.equal(badgeText(pct(4)), '4%');
  assert.equal(badgeText(pct(10.5)), '10%');
  assert.equal(badgeText(pct(0.3)), '0,3%');
  assert.equal(badgeText(pct(60, { upTo: true })), '60%');
  assert.equal(badgeText(eur(25)), '€25');
  assert.equal(badgeText(eur(0.5)), '€');
  assert.equal(badgeText(null), '✓');
  for (const value of [0.1, 0.29, 0.7, 1.1, 2.3, 5.01, 9.99, 10.5, 99.9]) {
    assert.ok(badgeText(pct(value)).length <= 4, `badge te lang voor ${value}`);
  }
});

test('CashbackXL: bedragen, lijstpagina en detailpagina worden gelezen', () => {
  assert.deepEqual(parseAmount('15,00%'), pct(15));
  assert.deepEqual(parseAmount(' 2,25% '), pct(2.25));
  assert.deepEqual(parseAmount('€ 25,00'), eur(25));
  assert.deepEqual(parseAmount('€&nbsp;22,-'), eur(22));
  assert.deepEqual(parseAmount('€ 1.250,00'), eur(1250));
  assert.deepEqual(parseAmount('&euro; 7,50'), eur(7.5));
  assert.deepEqual(parseAmount('€8.50'), eur(8.5));
  assert.deepEqual(parseAmount('€0.32'), eur(0.32));
  assert.deepEqual(parseAmount('€ 1.250'), eur(1250));
  assert.deepEqual(parseAmount('2.5%'), pct(2.5));
  assert.deepEqual(parseAmount('2.500 pnt'), { type: 'POINTS', value: 2500 });
  assert.deepEqual(parseAmount('900 ptn.'), { type: 'POINTS', value: 900 });
  assert.equal(formatCashback({ type: 'POINTS', value: 2500, upTo: true }), 'tot 2.500 punten');
  assert.equal(badgeText({ type: 'POINTS', value: 2500 }), 'pnt');
  assert.equal(parseAmount('gratis'), null);
  assert.equal(parseAmount(''), null);

  const list = `
    <div class="border-box-table webshops-list">
      <a class="border-box-filter" href="/webshops/amazon">
        <span class="filter">Amazon</span> <span class="filter">15,00%</span> <span class="filter">5</span>
      </a>
      <a class="border-box-filter" href="/webshops/h-m">
        <span class="filter">H&amp;M</span>
        <span class="filter">&euro; 2,50</span>
        <span class="filter">0</span>
      </a>
    </div>
    <a class="search-results__results__item" href="/webshops/aliexpress">niet uit de lijst</a>`;
  assert.deepEqual(parseListPage(list), [
    { slug: 'amazon', name: 'Amazon', amountText: '15,00%', offers: 5 },
    { slug: 'h-m', name: 'H&M', amountText: '€ 2,50', offers: 0 },
  ]);
  assert.deepEqual(parseListPage('<html>geen winkels</html>'), []);

  const detail = `
    <meta name="keywords" content="coolblue elektronica" />
    <meta name="description" content="Voucher-tegoed bij Coolblue &amp; meer" />
    <script type="application/ld+json">{ "logo": "https://static.example/logo.png",
      "aggregateRating": { "ratingValue": "9.2", "reviewCount": "46" } }</script>
    <div class="cash cash-space"> <h1> Tot 2,25% voucher tegoed </h1> <span class="domain">op coolblue.nl</span> </div>
    <div id="overview" class="border-box cashbacks">
      <div class="row row-header"> <h2>Voucher</h2> </div>
      <div class="row"> <span> 2,25% </span> Nieuwe klant </div>
      <div class="row"> <span> 1,5% </span> Bestaande klant </div>
    </div>
    <div class="border-box"> <div class="row"> <span>99%</span> hoort er niet bij </div> </div>`;
  const parsed = parseDetailPage(detail);
  assert.equal(parsed.domain, 'coolblue.nl');
  assert.equal(parsed.heading, 'Tot 2,25% voucher tegoed');
  assert.equal(parsed.voucher, true);
  assert.equal(parsed.overviewTitle, 'Voucher');
  assert.deepEqual(parsed.tiers, [
    { amountText: '2,25%', label: 'Nieuwe klant' },
    { amountText: '1,5%', label: 'Bestaande klant' },
  ]);
  assert.equal(parsed.rating, 9.2);
  assert.equal(parsed.reviewCount, 46);
  assert.equal(parsed.description, 'Voucher-tegoed bij Coolblue & meer');
  assert.deepEqual(domainRecord(parsed), { d: 'coolblue.nl', v: 1, t: 1 });

  const empty = parseDetailPage('<html><h1>Niets</h1></html>');
  assert.equal(empty.domain, null);
  assert.equal(empty.voucher, false);
  assert.deepEqual(domainRecord(empty), { d: '' });
});

test('CashbackXL: regels en het bijleren van domeinen', async () => {
  const shops = [
    { slug: 'surfshark', name: 'Surfshark', amountText: '60,00%', offers: 1 },
    { slug: 'coolblue', name: 'Coolblue', amountText: '2,25%', offers: 3 },
    { slug: 'geen-domein', name: 'Geen domein', amountText: '5,00%', offers: 0 },
    { slug: 'onbekend', name: 'Onbekend', amountText: '1,00%', offers: 0 },
  ];
  const entries = cashbackxlEntries(shops, {
    surfshark: { d: 'surfshark.com' },
    coolblue: { d: 'www.coolblue.nl', v: 1, t: 1 },
    'geen-domein': { d: '' },
  });
  assert.deepEqual(entries.map((entry) => entry.slug), ['surfshark', 'coolblue']);
  assert.deepEqual(entries[0].cashback, pct(60));
  assert.equal(entries[0].kind, 'cashback');
  assert.deepEqual(entries[1].cashback, pct(2.25, { upTo: true }));
  assert.equal(entries[1].kind, 'voucher');
  assert.deepEqual(entries[1].paths, { 'coolblue.nl': '' });
  assert.equal(cashbackxl.entryUrl(entries[0]), 'https://www.cashbackxl.nl/webshops/surfshark');
  // Zonder bedrag in de lijst doet de winkel niet mee, ook al is het domein bekend.
  assert.deepEqual(
    cashbackxlEntries([{ slug: 'gestopt', name: 'Gestopt', amountText: '', offers: 0 }], { gestopt: { d: 'gestopt.nl' } }),
    [],
  );

  const listHtml = (items) =>
    items
      .map(
        (shop) =>
          `<a class="border-box-filter" href="/webshops/${shop.slug}"><span class="filter">${shop.name}</span><span class="filter">${shop.amountText}</span><span class="filter">${shop.offers}</span></a>`,
      )
      .join('');
  const requested = [];
  const fakeFetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    requested.push(pathname + (searchParams.get('p') ? `?p=${searchParams.get('p')}` : ''));
    const respond = (html) => ({ ok: true, status: 200, text: async () => html, headers: new Headers() });
    if (pathname.startsWith('/zoeken/')) return respond(searchParams.get('p') === '1' ? listHtml(shops) : '');
    if (pathname === '/webshops/onbekend') return respond('<span class="domain">op onbekend.nl</span>');
    if (pathname === '/webshops/geen-domein') return { ok: false, status: 404, headers: new Headers() };
    return { ok: false, status: 500, headers: new Headers() };
  };

  const loaded = await cashbackxl.load({
    fetchImpl: fakeFetch,
    seed: { surfshark: { d: 'surfshark.com' }, coolblue: { d: 'coolblue.nl', v: 1 } },
    learned: {},
    delayMs: 0,
  });
  assert.equal(loaded.total, 4);
  assert.deepEqual(loaded.entries.map((entry) => entry.slug), ['surfshark', 'coolblue', 'onbekend']);
  assert.deepEqual(loaded.state.learned, { 'geen-domein': { d: '' }, onbekend: { d: 'onbekend.nl' } });
  assert.equal(loaded.pending, 0);
  // Bekende winkels worden niet opnieuw opgevraagd.
  assert.deepEqual(requested, ['/zoeken/%25?p=1', '/zoeken/%25?p=2', '/webshops/geen-domein', '/webshops/onbekend']);

  // Niet meer detailpagina's per keer dan afgesproken; de rest blijft openstaan.
  const limited = await cashbackxl.load({
    fetchImpl: fakeFetch,
    seed: { surfshark: { d: 'surfshark.com' } },
    learned: { coolblue: { d: 'coolblue.nl' } },
    maxDetails: 1,
    delayMs: 0,
  });
  assert.deepEqual(Object.keys(limited.state.learned), ['coolblue', 'geen-domein']);
  assert.equal(limited.pending, 1);

  // Een storing (geen 404) wordt niet onthouden, zodat het later opnieuw geprobeerd wordt.
  const failing = await cashbackxl.load({ fetchImpl: fakeFetch, seed: {}, learned: {}, maxDetails: 1, delayMs: 0 });
  assert.deepEqual(failing.state.learned, {});
  assert.equal(failing.pending, 4);
});

test('samenvoegen: hoogste cashback wint, bij gelijk de eerste aanbieder', () => {
  assert.ok(compareAmounts(pct(60), pct(40)) > 0);
  assert.equal(compareAmounts(pct(5), pct(5)), 0);
  assert.equal(compareAmounts(pct(5), eur(5)), null);
  assert.equal(compareAmounts(null, pct(5)), null);

  const [first, second] = PROVIDERS;
  const result = (...matches) => ({ host: 'winkel.nl', matches: matches.map((m) => ({ rank: 1, deals: 0, ...m })) });
  const offer = (name, cashback, extra = {}) => ({ name, cashback, ...extra });

  // De tweede aanbieder is hoger: die komt bovenaan.
  let combined = combine([
    { provider: first, result: result(offer('Surfshark', pct(40))) },
    { provider: second, result: result(offer('Surfshark', pct(60))) },
  ]);
  assert.equal(combined.best.providerId, second.id);
  assert.equal(combined.verdict, 'better');
  assert.deepEqual(combined.others.map((o) => o.providerId), [first.id]);
  assert.deepEqual(badgeFor(combined, labelOf), {
    text: '60%',
    title: `Surfshark: ${second.label} 60% (${first.label} 40%)`,
  });

  // Gelijk: de eerste aanbieder heeft de voorkeur.
  combined = combine([
    { provider: first, result: result(offer('A', pct(5))) },
    { provider: second, result: result(offer('A', pct(5))) },
  ]);
  assert.equal(combined.best.providerId, first.id);
  assert.equal(combined.verdict, 'equal');

  // Procent tegenover euro's is niet te vergelijken: ook dan de eerste.
  combined = combine([
    { provider: first, result: result(offer('A', eur(10))) },
    { provider: second, result: result(offer('A', pct(50))) },
  ]);
  assert.equal(combined.best.providerId, first.id);
  assert.equal(combined.verdict, 'incomparable');

  // Maar één aanbieder kent de winkel.
  combined = combine([
    { provider: first, result: null },
    { provider: second, result: result(offer('A', pct(3))) },
  ]);
  assert.equal(combined.best.providerId, second.id);
  assert.equal(combined.verdict, 'only');
  assert.deepEqual(combined.others, []);
  assert.equal(badgeFor(combined, labelOf).title, `A: ${second.label} 3%`);

  // Overige aanbiedingen: eerst de beste van de andere aanbieder, dan de rest.
  combined = combine([
    { provider: first, result: result(offer('Winkel', pct(4)), offer('Winkel Energie', eur(25), { rank: 0 })) },
    { provider: second, result: result(offer('Winkel', pct(6))) },
  ]);
  assert.equal(combined.best.name, 'Winkel');
  assert.equal(combined.best.providerId, second.id);
  assert.deepEqual(combined.others.map((o) => `${o.providerId}:${o.name}`), [`${first.id}:Winkel`, `${first.id}:Winkel Energie`]);
  assert.equal(combined.ambiguous, false);
  assert.equal(combined.count, 3);

  // Meerdere aanbiedingen die even goed passen: de badge toont het aantal.
  combined = combine([
    { provider: first, result: result(offer('Polis A', eur(16)), offer('Polis B', eur(24))) },
    { provider: second, result: null },
  ]);
  assert.equal(combined.ambiguous, true);
  assert.deepEqual(badgeFor(combined, labelOf), { text: '2×', title: 'Cashback: 2 aanbiedingen voor winkel.nl' });

  // Heeft de ene aanbieder meerdere gelijkwaardige aanbiedingen en de andere één
  // duidelijke, dan komt de duidelijke bovenaan en is er geen eerlijke vergelijking.
  combined = combine([
    { provider: first, result: result(offer('Polis A', eur(16)), offer('Polis B', eur(90))) },
    { provider: second, result: result(offer('Verzekeraar', eur(75))) },
  ]);
  assert.equal(combined.best.name, 'Verzekeraar');
  assert.equal(combined.ambiguous, false);
  assert.equal(combined.verdict, 'incomparable');
  assert.deepEqual(combined.others.map((o) => o.name), ['Polis A', 'Polis B']);
  assert.equal(badgeFor(combined, labelOf).text, '€75');

  // Punten zijn niet met geld te vergelijken: de eerste aanbieder blijft bovenaan.
  combined = combine([
    { provider: first, result: result(offer('Kaart', eur(25))) },
    { provider: second, result: result(offer('Kaart', { type: 'POINTS', value: 2500 })) },
  ]);
  assert.equal(combined.best.providerId, first.id);
  assert.equal(combined.verdict, 'incomparable');

  assert.equal(combine([{ provider: first, result: null }, { provider: second, result: null }]), null);
  assert.equal(combine([]), null);
});

test('instellingen: onbekende of ontbrekende waarden vallen terug op aan', () => {
  const ids = PROVIDERS.map((provider) => provider.id);
  assert.deepEqual(ids, ['shopbuddies', 'cashbackxl']);
  assert.deepEqual(normalizeSettings(undefined).providers, { shopbuddies: true, cashbackxl: true });
  assert.deepEqual(normalizeSettings({ providers: { cashbackxl: false, vreemd: true } }).providers, {
    shopbuddies: true,
    cashbackxl: false,
  });
  assert.deepEqual(normalizeSettings({ providers: { shopbuddies: 'nee' } }).providers, {
    shopbuddies: true,
    cashbackxl: true,
  });
});

test('fetchAllMerchants bladert en stopt bij een herhaalde pagina', async () => {
  const pages = {
    '': { data: { merchants: [{ id: 'a' }, { id: 'b' }] }, meta: { pagination: { nextToken: 't1' } } },
    t1: { data: { merchants: [{ id: 'c' }] }, meta: { pagination: {} } },
  };
  const calls = [];
  const fakeFetch = async (url) => {
    const token = new URL(url).searchParams.get('pageToken') || '';
    calls.push(token);
    return { ok: true, status: 200, json: async () => pages[token] };
  };
  const all = await fetchAllMerchants({ fetchImpl: fakeFetch, delayMs: 0 });
  assert.deepEqual(all.map((m) => m.id), ['a', 'b', 'c']);
  assert.deepEqual(calls, ['', 't1']);

  // Server negeert de token en geeft steeds pagina 1: na één herhaling stoppen.
  let stuckCalls = 0;
  const stuck = async () => {
    stuckCalls++;
    return { ok: true, status: 200, json: async () => pages[''] };
  };
  const once = await fetchAllMerchants({ fetchImpl: stuck, delayMs: 0 });
  assert.equal(once.length, 2);
  assert.equal(stuckCalls, 2);

  await assert.rejects(
    fetchAllMerchants({ fetchImpl: async () => ({ ok: false, status: 503 }), delayMs: 0 }),
    /status 503/,
  );
});

test('echte ShopBuddies-lijst: bekende winkels worden gevonden', { skip: !shopbuddiesData }, () => {
  const entries = shopbuddiesEntries(shopbuddiesData);
  const index = buildIndex(entries, shopbuddiesData.length);
  const names = (url) => lookup(index, url)?.matches.map((m) => m.name) ?? null;

  assert.equal(names('https://www.bol.com/nl/nl/p/iets/9300000/')[0], 'bol.');
  assert.equal(names('https://www.zalando.nl/heren/')[0], 'Zalando');
  assert.equal(names('https://m.hema.nl/')[0], 'HEMA');
  assert.equal(names('https://www.mediamarkt.nl/nl/product/x.html')[0], 'MediaMarkt');
  assert.equal(names('https://www.amazon.nl/dp/B000')[0], 'Amazon');
  assert.equal(names('https://www.brabantia.com/nl_nl/')[0], 'Brabantia'); // alleen via websiteUrls
  assert.equal(names('https://www.coolblue.nl/product/123')[0], 'Coolblue');
  assert.equal(names('https://www.coolblue.nl/energiecontracten/stroom')[0], 'Coolblue Energie');
  assert.ok(names('https://www.kpn.com/internet').length >= 3); // bron-URL zonder schema

  assert.equal(names('https://www.awin1.com/cread.php?s=4834124'), null);
  assert.equal(names('https://che01.safelinks.protection.outlook.com/'), null);
  assert.equal(names('https://www.wikipedia.org/'), null);
  assert.equal(names('https://shopbuddies.nl/cashback/deals'), null);

  for (const host of Object.keys(index.hosts)) {
    assert.equal(isTrackingHost(host), false, `trackingdomein in index: ${host}`);
    assert.ok(host.includes('.') && !host.startsWith('www.'), `vreemde host: ${host}`);
  }
  console.log(
    `  ShopBuddies: ${index.total} winkels, ${entries.length} met domein, ` +
      `${Object.keys(index.hosts).length} domeinen, index ${Math.round(JSON.stringify(index).length / 1024)} KB`,
  );
});

test(
  'echte CashbackXL-lijst: bekende winkels worden gevonden en vergeleken',
  { skip: !cashbackxlData || !cashbackxlSeed || !shopbuddiesData },
  () => {
    const shops = cashbackxlData.map((record) => ({
      slug: record.slug,
      name: record.name,
      amountText: record.cashbackText,
      offers: record.offers,
    }));
    const entries = cashbackxlEntries(shops, cashbackxlSeed);
    const xlIndex = buildIndex(entries, shops.length);
    const sbIndex = buildIndex(shopbuddiesEntries(shopbuddiesData), shopbuddiesData.length);

    const surfshark = lookup(xlIndex, 'https://surfshark.com/nl/pricing');
    assert.equal(surfshark.matches[0].name, 'Surfshark');
    assert.equal(lookup(xlIndex, 'https://www.coolblue.nl/product/1').matches[0].kind, 'voucher');
    assert.equal(lookup(xlIndex, 'https://www.wikipedia.org/'), null);
    assert.equal(lookup(xlIndex, 'https://www.cashbackxl.nl/webshops'), null);

    for (const host of Object.keys(xlIndex.hosts)) {
      assert.equal(isTrackingHost(host), false, `trackingdomein in index: ${host}`);
      assert.ok(host.includes('.') && !host.startsWith('www.'), `vreemde host: ${host}`);
    }

    const [sb, xl] = PROVIDERS;
    const combined = combine([
      { provider: sb, result: lookup(sbIndex, 'https://surfshark.com/') },
      { provider: xl, result: lookup(xlIndex, 'https://surfshark.com/') },
    ]);
    assert.ok(combined.best.cashback.value >= combined.others[0].cashback.value);

    const shared = Object.keys(xlIndex.hosts).filter((host) => sbIndex.hosts[host]).length;
    console.log(
      `  CashbackXL: ${shops.length} winkels, ${entries.length} met domein, ` +
        `${Object.keys(xlIndex.hosts).length} domeinen, waarvan ${shared} ook bij ShopBuddies`,
    );
  },
);
