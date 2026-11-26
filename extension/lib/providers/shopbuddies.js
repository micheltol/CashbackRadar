// ShopBuddies: de winkellijst komt als JSON van het endpoint dat hun site zelf gebruikt.

import { fetchAllMerchants, fetchMerchantPage, PAGE_SIZE } from '../api.js';
import { hostFromUrl, isTrackingHost } from '../domains.js';

function compactAmount(amount) {
  const value = amount?.amount?.value;
  if (typeof value !== 'number' || !amount?.amountType) return null;
  const scaled = value / 10 ** (amount.amount.scalingFactor ?? 2);
  if (amount.amountType === 'FIXED') return { type: 'FIXED', value: scaled };
  if (amount.amountType === 'PERCENTAGE') return { type: 'PERCENTAGE', value: scaled };
  // De site toont dit type als "Tot x%".
  if (amount.amountType === 'PROGRESSIVE_PERCENTAGE') return { type: 'PERCENTAGE', value: scaled, upTo: true };
  return null;
}

/** Zet de ruwe winkels om naar regels voor de opzoektabel; winkels zonder domein vallen af. */
export function toEntries(merchants, country = 'NL') {
  const entries = [];
  for (const merchant of merchants) {
    // Volgorde bepaalt welk pad bij een domein hoort: eerst de landspecifieke URL,
    // dan de algemene, dan de aliassen (die hebben nooit een pad).
    const sources = [
      merchant.countryWebsiteUrls?.[country],
      merchant.websiteUrl,
      ...(merchant.websiteUrls || []),
    ];

    const paths = {};
    for (const source of sources) {
      const parsed = hostFromUrl(source);
      if (!parsed || isTrackingHost(parsed.host)) continue;
      if (!(parsed.host in paths)) paths[parsed.host] = parsed.path;
    }
    if (Object.keys(paths).length === 0) continue;

    const entry = {
      id: merchant.id,
      name: (merchant.name || '').trim(),
      slug: merchant.countrySlugs?.[country] || null,
      cashback: compactAmount(merchant.cashbackAmount),
      kind: 'cashback',
      deals: merchant.dealCount || 0,
      paths,
    };
    const stockPoints = compactAmount(merchant.stockpointsAmount);
    if (stockPoints) entry.stockPoints = stockPoints;
    if (merchant.isAutoReward) entry.autoReward = true;
    if (merchant.lowReliability) entry.lowReliability = true;
    entries.push(entry);
  }
  return entries;
}

export const shopbuddies = {
  id: 'shopbuddies',
  label: 'ShopBuddies',
  home: 'https://shopbuddies.nl/cashback/deals',
  pageSize: PAGE_SIZE,

  /** De id werkt ook als er geen slug is; de site stuurt dan zelf door. */
  entryUrl(entry) {
    return `https://shopbuddies.nl/cashback/${encodeURIComponent(entry.slug || entry.id)}`;
  },

  async load({ fetchImpl = fetch, delayMs = 150 } = {}) {
    const merchants = await fetchAllMerchants({ fetchImpl, delayMs });
    return { entries: toEntries(merchants), total: merchants.length, pending: 0, state: null };
  },

  /**
   * Eén pagina voor het geleidelijk verversen (zie lib/incremental.js).
   * @param {object} options
   * @param {string|null} options.cursor  bladwijzer van de vorige stap, null voor de eerste pagina
   */
  async loadPage({ cursor = null, fetchImpl = fetch } = {}) {
    const { merchants, nextToken } = await fetchMerchantPage({ pageToken: cursor, fetchImpl });
    const done = !nextToken || nextToken === cursor || merchants.length === 0;
    return {
      ids: merchants.map((merchant) => merchant.id),
      entries: toEntries(merchants),
      unknown: 0,
      next: done ? null : nextToken,
      state: null,
    };
  },
};
