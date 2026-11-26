// Haalt alle CashbackXL-winkels op, inclusief de detailpagina van elke winkel, en schrijft:
//   data/cashbackxl-nl.json                  volledige lijst voor eigen analyse
//   extension/data/cashbackxl-domains.json   domein per winkel, meegeleverd met de extensie
//
// Dit zijn ruim 1.400 pagina's en de site begrenst het aantal verzoeken, dus het script
// doet er bewust lang over (ruim een half uur) en vertraagt verder als de site daarom vraagt.
//
// Gebruik: node tools/fetch-cashbackxl.mjs [--cache <map>]
// Met --cache worden opgehaalde pagina's bewaard, zodat opnieuw draaien verdergaat waar het was.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fetchShopList,
  parseDetailPage,
  parseAmount,
  domainRecord,
} from '../extension/lib/providers/cashbackxl.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = join(root, 'data', 'cashbackxl-nl.json');
const seedFile = join(root, 'extension', 'data', 'cashbackxl-domains.json');

const cacheArg = process.argv.indexOf('--cache');
const cacheDir = cacheArg >= 0 ? process.argv[cacheArg + 1] : null;
if (cacheDir) mkdirSync(cacheDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Verzoeken starten met een vaste tussenpoos (de pagina's zelf zijn traag, dus er
// lopen er een paar tegelijk). Bij status 429 wacht alles en wordt de tussenpoos
// blijvend groter.
const WORKERS = 3;
let intervalMs = 1000;
let nextSlot = 0;
let rateLimited = 0;

async function politeFetch(url, options) {
  for (let attempt = 1; ; attempt++) {
    const slot = Math.max(Date.now(), nextSlot);
    nextSlot = slot + intervalMs;
    if (slot > Date.now()) await sleep(slot - Date.now());

    const response = await fetch(url, options);
    if (response.status !== 429) return response;

    rateLimited++;
    if (attempt >= 8) return response;
    const retryAfter = Number(response.headers.get('retry-after'));
    const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 30000 * attempt;
    intervalMs = Math.min(Math.round(intervalMs * 1.4), 6000);
    nextSlot = Math.max(nextSlot, Date.now() + pause); // ook de andere verzoeken wachten mee
    console.log(`  verzoekgrens bereikt; ${Math.round(pause / 1000)} s wachten, tussenpoos nu ${intervalMs} ms`);
    await sleep(pause);
  }
}

function cachePath(name) {
  return cacheDir ? join(cacheDir, `${name.replace(/[^a-z0-9_-]/gi, '_')}.html.gz`) : null;
}

// Geeft de lijstpagina's en detailpagina's uit de cache als ze er zijn.
async function cachedFetch(url, options) {
  const file = cachePath(new URL(url).pathname.replace(/^\/+/, '') + new URL(url).search);
  if (file && existsSync(file)) {
    const html = gunzipSync(readFileSync(file)).toString('utf8');
    return { ok: true, status: 200, text: async () => html, headers: new Headers() };
  }
  const response = await politeFetch(url, options);
  if (!response.ok) return response;
  const html = await response.text();
  if (file) writeFileSync(file, gzipSync(html));
  return { ok: true, status: 200, text: async () => html, headers: response.headers };
}

const shops = await fetchShopList({ fetchImpl: cachedFetch, delayMs: 0 });
console.log(`${shops.length} winkels in de lijst; detailpagina's ophalen…`);

const records = new Array(shops.length);
const failures = [];
let cursor = 0;
let done = 0;

async function worker() {
  while (cursor < shops.length) {
    const position = cursor++;
    records[position] = await describe(shops[position]);
    if (++done % 100 === 0) console.log(`  ${done}/${shops.length}`);
  }
}

async function describe(shop) {
  let detail = null;
  try {
    const response = await cachedFetch(`https://www.cashbackxl.nl/webshops/${encodeURIComponent(shop.slug)}`, {
      headers: { accept: 'text/html' },
    });
    if (response.ok) detail = parseDetailPage(await response.text());
    else failures.push(`${shop.slug}: status ${response.status}`);
  } catch (error) {
    failures.push(`${shop.slug}: ${error.message}`);
  }

  return {
    slug: shop.slug,
    name: shop.name,
    url: `https://www.cashbackxl.nl/webshops/${shop.slug}`,
    domain: detail?.domain ?? null,
    cashbackText: shop.amountText,
    cashback: parseAmount(shop.amountText),
    offers: shop.offers,
    voucher: detail?.voucher ?? null,
    heading: detail?.heading ?? null,
    overviewTitle: detail?.overviewTitle ?? null,
    tiers: (detail?.tiers ?? []).map((tier) => ({ ...tier, amount: parseAmount(tier.amountText) })),
    rating: detail?.rating ?? null,
    reviewCount: detail?.reviewCount ?? null,
    description: detail?.description ?? null,
    keywords: detail?.keywords ?? null,
    logo: detail?.logo ?? null,
    detailFetched: detail !== null,
  };
}

await Promise.all(Array.from({ length: WORKERS }, worker));

const seed = {};
for (const record of records) {
  // Mislukte pagina's slaan we over; de extensie probeert die later zelf nog eens.
  if (!record.detailFetched) continue;
  seed[record.slug] = domainRecord({ domain: record.domain, voucher: record.voucher, tiers: record.tiers });
}

mkdirSync(dirname(dataFile), { recursive: true });
mkdirSync(dirname(seedFile), { recursive: true });
writeFileSync(dataFile, JSON.stringify(records, null, 2));
writeFileSync(seedFile, JSON.stringify(seed));

const withDomain = records.filter((record) => record.domain).length;
console.log(`${records.length} winkels geschreven naar ${dataFile}`);
console.log(`${withDomain} met domein; ${Object.keys(seed).length} regels in ${seedFile}`);
console.log(`${rateLimited} keer de verzoekgrens geraakt; laatste tussenpoos ${intervalMs} ms`);
if (failures.length) console.log(`${failures.length} mislukt:\n  ${failures.slice(0, 20).join('\n  ')}`);
