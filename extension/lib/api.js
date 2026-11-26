// Haalt de winkellijst op bij ShopBuddies. Dit is geen officiële API: het is het
// endpoint dat de site zelf gebruikt, dus het kan zonder aankondiging wijzigen.

const ENDPOINT = 'https://shopbuddies.nl/api/wsProxy/merchants-overview/api/v0.0.1/merchants';
export const PAGE_SIZE = 100; // het maximum dat de server accepteert
const MAX_PAGES = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Eén pagina van de lijst. De bladwijzer (pageToken) is een vaste plek in de lijst
 * (laatste winkel plus aanmaakdatum) en blijft dus ook later bruikbaar; kent de
 * server hem niet meer, dan volgt status 400.
 *
 * @returns {Promise<{merchants: object[], nextToken: string|null}>}
 */
export async function fetchMerchantPage({ country = 'NL', pageToken = null, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ country, limit: String(PAGE_SIZE) });
  if (pageToken) params.set('pageToken', pageToken);

  const response = await fetchImpl(`${ENDPOINT}?${params}`, {
    credentials: 'omit',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(`ShopBuddies gaf status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const body = await response.json();
  const list = body?.data?.merchants;
  if (!Array.isArray(list)) throw new Error('Onverwacht antwoord van ShopBuddies');

  return {
    merchants: list.filter((merchant) => merchant?.id),
    nextToken: body?.meta?.pagination?.nextToken || null,
  };
}

/**
 * @returns {Promise<object[]>} alle winkels voor het land, ongewijzigd
 */
export async function fetchAllMerchants({ country = 'NL', fetchImpl = fetch, delayMs = 150 } = {}) {
  const merchants = [];
  const seenIds = new Set();
  let pageToken = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let result;
    try {
      result = await fetchMerchantPage({ country, pageToken, fetchImpl });
    } catch (error) {
      error.message += ` (pagina ${page + 1})`;
      throw error;
    }

    let added = 0;
    for (const merchant of result.merchants) {
      if (seenIds.has(merchant.id)) continue;
      seenIds.add(merchant.id);
      merchants.push(merchant);
      added++;
    }

    // Stop ook als de server dezelfde pagina blijft teruggeven (bijvoorbeeld
    // wanneer de naam van de bladerparameter ooit verandert).
    if (!result.nextToken || result.nextToken === pageToken || added === 0) return merchants;

    pageToken = result.nextToken;
    await sleep(delayMs);
  }

  throw new Error(`Winkellijst is groter dan ${MAX_PAGES * PAGE_SIZE} winkels; ophalen afgebroken`);
}
