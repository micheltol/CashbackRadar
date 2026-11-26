// Domeinen normaliseren en vergelijken. Geen browser-API's: dit draait ook in Node (tests).

// Affiliate- en doorstuurdomeinen die in de winkellijst als "website" staan maar
// niet de winkel zelf zijn. Een bezoek aan zo'n domein mag nooit een match geven.
const TRACKING_SUFFIXES = [
  'awin1.com',
  'prf.hn',
  'pxf.io',
  'sjv.io',
  'linksynergy.com',
  'tradedoubler.com',
  'tradetracker.net',
  'daisycon.io',
  'ds1.nl',
  'lt45.net',
  'jf79.net',
  'webgains.com',
  'anrdoezrs.net',
  'dpbolvw.net',
  'kqzyfj.com',
  'tkqlhce.com',
  'jdoqocy.com',
  'safelinks.protection.outlook.com',
];

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Haalt host en pad uit een URL zoals die in de winkellijst of in een tab staat.
 * Accepteert ook waarden zonder schema ("kpn.com", "unive.nl/opstalverzekering").
 * Geeft null bij alles wat geen gewone webpagina is.
 */
export function hostFromUrl(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) return null;

  let parsed;
  try {
    parsed = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return null;
  }

  let host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!HOST_PATTERN.test(host)) return null;

  return { host, path: normalizePath(parsed.pathname) };
}

/** "/Energie/" -> "/energie"; de root wordt een lege string. */
export function normalizePath(pathname) {
  return (pathname || '').toLowerCase().replace(/\/+$/, '');
}

export function isTrackingHost(host) {
  return TRACKING_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * De host zelf en daarna steeds een niveau hoger, tot er twee labels over zijn.
 * "m.shop.voorbeeld.nl" -> ["m.shop.voorbeeld.nl", "shop.voorbeeld.nl", "voorbeeld.nl"].
 */
export function candidateHosts(host) {
  const labels = host.split('.');
  const candidates = [];
  for (let i = 0; labels.length - i >= 2; i++) {
    candidates.push(labels.slice(i).join('.'));
  }
  return candidates;
}

/** Waar als `path` gelijk is aan `prefix` of eronder valt ("/a/b" valt onder "/a"). */
export function pathStartsWith(path, prefix) {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}
