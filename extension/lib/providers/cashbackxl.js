// CashbackXL heeft geen JSON-lijst. De winkels staan op genummerde lijstpagina's
// (naam, hoogste cashback, aantal aanbiedingen); het domein van de winkel staat
// alleen op de detailpagina. Daarom: de lijst halen we dagelijks op, de domeinen
// komen uit een meegeleverd bestand en worden voor nieuwe winkels bijgeleerd.
//
// Geen DOMParser: dit draait in een service worker en in Node, dus alles gaat met
// reguliere expressies op vaste stukjes van de pagina.

import { hostFromUrl, isTrackingHost } from '../domains.js';

const ORIGIN = 'https://www.cashbackxl.nl';
const LIST_PATH = '/zoeken/%25'; // zoeken op "%" geeft alle winkels
const MAX_LIST_PAGES = 80;
const PAGE_SIZE = 50; // winkels per lijstpagina
const DEFAULT_MAX_DETAILS = 20; // nieuwe winkels per volledige verversing, om de site te sparen
const STEP_MAX_DETAILS = 3; // nieuwe winkels per stap van het geleidelijk verversen
const DEFAULT_DELAY_MS = 1500; // pauze tussen twee verzoeken
const RATE_LIMIT_RETRIES = 2;
// Kort genoeg om een service worker niet te laten inslapen (die stopt na 30 s stilte).
const RATE_LIMIT_WAIT_MS = 20000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NAMED_ENTITIES = {
  amp: '&', nbsp: ' ', euro: '€', quot: '"', apos: "'", lt: '<', gt: '>',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â',
  auml: 'ä', iuml: 'ï', iacute: 'í', oacute: 'ó', ouml: 'ö', ocirc: 'ô', uuml: 'ü',
  uacute: 'ú', ccedil: 'ç', ntilde: 'ñ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—',
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Haalt tags weg, zet entiteiten om en maakt van alle witruimte één spatie. */
export function cleanText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "15,00%" -> 15 procent; "€ 1.250,00" -> 1250 euro; "€ 22,-" -> 22 euro.
 * De site schrijft decimalen soms met een punt ("€8.50"); een punt gevolgd door
 * precies drie cijfers is een duizendtal.
 */
export function parseAmount(text) {
  const value = cleanText(text);
  const match = value.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:[.,](\d{1,2})(?!\d))?/);
  if (!match) return null;
  const number = Number(`${match[1].replace(/\./g, '')}.${match[2] || '0'}`);
  if (!Number.isFinite(number)) return null;
  if (value.includes('%')) return { type: 'PERCENTAGE', value: number };
  if (value.includes('€')) return { type: 'FIXED', value: number };
  // Bij sommige winkels (vooral verzekeringen) spaar je punten in plaats van geld.
  if (/\b(pnt|ptn|punten)\b/i.test(value)) return { type: 'POINTS', value: number };
  return null;
}

const LIST_ITEM =
  /<a class="border-box-filter" href="\/webshops\/([^"/?#]+)">\s*<span class="filter">([\s\S]*?)<\/span>\s*<span class="filter">([\s\S]*?)<\/span>\s*<span class="filter">([\s\S]*?)<\/span>/g;

/** @returns {{slug:string,name:string,amountText:string,offers:number}[]} */
export function parseListPage(html) {
  const shops = [];
  for (const match of html.matchAll(LIST_ITEM)) {
    shops.push({
      slug: decodeEntities(match[1]),
      name: cleanText(match[2]),
      amountText: cleanText(match[3]),
      offers: Number.parseInt(cleanText(match[4]), 10) || 0,
    });
  }
  return shops;
}

function firstMatch(html, pattern) {
  const match = html.match(pattern);
  return match ? cleanText(match[1]) : null;
}

/** Leest de velden van een winkelpagina; ontbrekende velden worden null. */
export function parseDetailPage(html) {
  const domainText = firstMatch(html, /<span class="domain">([\s\S]*?)<\/span>/);
  const heading = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/);

  let overviewTitle = null;
  const tiers = [];
  const start = html.indexOf('border-box cashbacks');
  if (start >= 0) {
    const end = html.indexOf('class="border-box"', start);
    const block = html.slice(start, end > start ? end : start + 20000);
    overviewTitle = firstMatch(block, /<h2[^>]*>([\s\S]*?)<\/h2>/);
    for (const row of block.matchAll(/<div class="row">\s*<span>([\s\S]*?)<\/span>([\s\S]*?)<\/div>/g)) {
      tiers.push({ amountText: cleanText(row[1]), label: cleanText(row[2]) });
    }
  }

  const rating = html.match(/"ratingValue":\s*"([^"]+)"/);
  const reviews = html.match(/"reviewCount":\s*"([^"]+)"/);
  const logo = html.match(/"logo":\s*"([^"]+)"/);
  const description = html.match(/<meta name="description" content="([^"]*)"/);
  const keywords = html.match(/<meta name="keywords" content="([^"]*)"/);

  return {
    domain: domainText ? domainText.replace(/^op\s+/i, '').trim() || null : null,
    heading,
    voucher: /voucher/i.test(`${overviewTitle || ''} ${heading || ''}`),
    overviewTitle,
    tiers,
    rating: rating ? Number(rating[1]) : null,
    reviewCount: reviews ? Number(reviews[1]) : null,
    logo: logo ? logo[1] : null,
    description: description ? decodeEntities(description[1]) : null,
    keywords: keywords ? decodeEntities(keywords[1]) : null,
  };
}

// De site begrenst het aantal verzoeken (status 429 na ongeveer twintig snelle
// verzoeken). We vragen daarom rustig op en wachten even als de grens toch bereikt is.
async function getHtml(path, fetchImpl, { retries = RATE_LIMIT_RETRIES } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(`${ORIGIN}${path}`, {
      credentials: 'omit',
      headers: { accept: 'text/html' },
    });
    if (response.ok) return response.text();

    if (response.status === 429 && attempt < retries) {
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_WAIT_MS;
      await sleep(Math.min(waitMs, RATE_LIMIT_WAIT_MS));
      continue;
    }
    const error = new Error(`CashbackXL gaf status ${response.status} voor ${path}`);
    error.status = response.status;
    throw error;
  }
}

/** Alle winkels van de lijstpagina's, zonder dubbelen. */
export async function fetchShopList({ fetchImpl = fetch, delayMs = DEFAULT_DELAY_MS } = {}) {
  const shops = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const items = parseListPage(await getHtml(`${LIST_PATH}?p=${page}`, fetchImpl));
    let added = 0;
    for (const shop of items) {
      if (seen.has(shop.slug)) continue;
      seen.add(shop.slug);
      shops.push(shop);
      added++;
    }
    // Voorbij de laatste pagina komt een lege lijst; een herhaalde pagina stopt ook.
    if (added === 0) return shops;
    await sleep(delayMs);
  }
  throw new Error(`CashbackXL-lijst heeft meer dan ${MAX_LIST_PAGES} pagina's; ophalen afgebroken`);
}

export async function fetchShopDetail(slug, { fetchImpl = fetch, retries } = {}) {
  return parseDetailPage(await getHtml(`/webshops/${encodeURIComponent(slug)}`, fetchImpl, { retries }));
}

/**
 * Compacte vorm waarin het domein van een winkel wordt bewaard:
 * { d: domein of '' als de pagina er geen noemt, v: 1 bij voucher-tegoed, t: 1 bij meerdere tarieven }.
 */
export function domainRecord(detail) {
  const record = { d: detail.domain || '' };
  if (detail.voucher) record.v = 1;
  if (detail.tiers.length > 1) record.t = 1;
  return record;
}

/** Combineert de lijst met de bekende domeinen tot regels voor de opzoektabel. */
export function toEntries(shops, domains) {
  const entries = [];
  for (const shop of shops) {
    const record = domains[shop.slug];
    const parsed = record?.d ? hostFromUrl(record.d) : null;
    if (!parsed || isTrackingHost(parsed.host)) continue;

    // Zonder bedrag in de lijst is de winkel niet (meer) actief bij CashbackXL.
    const amount = parseAmount(shop.amountText);
    if (!amount) continue;
    entries.push({
      id: shop.slug,
      name: shop.name,
      slug: shop.slug,
      cashback: record.t ? { ...amount, upTo: true } : amount,
      kind: record.v ? 'voucher' : 'cashback',
      deals: shop.offers,
      paths: { [parsed.host]: parsed.path },
    });
  }
  return entries;
}

/**
 * Haalt van winkels zonder bekend domein de detailpagina op, hooguit maxDetails per
 * keer, en geeft de bijgewerkte bijgeleerde domeinen terug.
 */
async function learnDomains(shops, { seed, learned, maxDetails, delayMs, fetchImpl, retries }) {
  const nextLearned = { ...learned };
  let fetched = 0;
  for (const shop of shops) {
    if (seed[shop.slug] || nextLearned[shop.slug]) continue;
    if (fetched >= maxDetails) break;
    fetched++;
    await sleep(delayMs);
    try {
      nextLearned[shop.slug] = domainRecord(await fetchShopDetail(shop.slug, { fetchImpl, retries }));
    } catch (error) {
      // Een verdwenen pagina hoeven we niet steeds opnieuw te proberen.
      if (error.status === 404) nextLearned[shop.slug] = { d: '' };
      // Bij een verzoekgrens heeft doorgaan geen zin; de rest komt een volgende keer.
      if (error.status === 429) break;
    }
  }
  return nextLearned;
}

export const cashbackxl = {
  id: 'cashbackxl',
  label: 'CashbackXL',
  home: `${ORIGIN}/webshops`,
  seedFile: 'data/cashbackxl-domains.json', // gemaakt door tools/fetch-cashbackxl.mjs
  pageSize: PAGE_SIZE,

  entryUrl(entry) {
    return `${ORIGIN}/webshops/${encodeURIComponent(entry.slug)}`;
  },

  /**
   * @param {object} options
   * @param {object} options.seed     meegeleverde domeinen (slug -> record)
   * @param {object} options.learned  eerder bijgeleerde domeinen (slug -> record)
   * @returns entries, het totaal en de bijgewerkte bijgeleerde domeinen
   */
  async load({ fetchImpl = fetch, seed = {}, learned = {}, maxDetails = DEFAULT_MAX_DETAILS, delayMs = DEFAULT_DELAY_MS } = {}) {
    const shops = await fetchShopList({ fetchImpl, delayMs });
    const nextLearned = await learnDomains(shops, { seed, learned, maxDetails, delayMs, fetchImpl });

    const domains = { ...nextLearned, ...seed };
    return {
      entries: toEntries(shops, domains),
      total: shops.length,
      pending: shops.filter((shop) => !domains[shop.slug]).length,
      state: { learned: nextLearned },
    };
  },

  /**
   * Eén lijstpagina voor het geleidelijk verversen (zie lib/incremental.js). Bij een
   * verzoekgrens wordt hier niet gewacht: de stap mislukt en komt later terug.
   *
   * @param {object} options
   * @param {number|null} options.cursor  paginanummer, null voor de eerste pagina
   */
  async loadPage({ cursor = null, fetchImpl = fetch, seed = {}, learned = {}, maxDetails = STEP_MAX_DETAILS, delayMs = DEFAULT_DELAY_MS } = {}) {
    const page = cursor || 1;
    const shops = parseListPage(await getHtml(`${LIST_PATH}?p=${page}`, fetchImpl, { retries: 0 }));
    const nextLearned = await learnDomains(shops, { seed, learned, maxDetails, delayMs, fetchImpl, retries: 0 });
    const domains = { ...nextLearned, ...seed };
    return {
      ids: shops.map((shop) => shop.slug),
      entries: toEntries(shops, domains),
      unknown: shops.filter((shop) => !domains[shop.slug]).length,
      // Voorbij de laatste pagina komt een lege lijst: de ronde is dan klaar.
      next: shops.length ? page + 1 : null,
      state: { learned: nextLearned },
    };
  },
};
