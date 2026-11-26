// Geleidelijk verversen. In plaats van één keer per dag de hele lijst op te halen,
// haalt de extensie om de zoveel minuten één pagina per aanbieder op en werkt daarmee
// de bestaande lijst bij. Een "ronde" is één keer door alle pagina's heen.
//
// Elke regel krijgt het nummer van de ronde waarin hij voor het laatst op een pagina
// stond (`round`). Een winkel die twee rondes achter elkaar niet meer voorkomt, wordt
// verwijderd. Twee en niet één: tijdens een ronde kan de lijst bij de aanbieder
// verschuiven, waardoor een winkel een keer tussen twee pagina's door kan glippen.
//
// Dit bestand bevat alleen de boekhouding; het ophalen zelf doet de aanbieder
// (loadPage) en het inplannen doet background.js.

/** Een ronde telt alleen als hij minstens dit deel van de vorige lijst heeft gezien. */
export const MIN_ROUND_SHARE = 0.7;

const MINUTE = 60 * 1000;
const PAUSE_MINUTES = 30; // eerste pauze na een mislukte stap
const PAUSE_MINUTES_RATE_LIMIT = 60; // eerste pauze als de site verzoeken weigert (429)
const MAX_PAUSE_MINUTES = 6 * 60;
// Statussen waarbij de bladwijzer zelf niet meer klopt: de ronde begint dan opnieuw.
const STALE_CURSOR_STATUSES = [400, 404, 410];

/**
 * Stand van een ronde:
 *   round        nummer van de lopende ronde
 *   cursor       waar de volgende stap verder gaat (null = eerste pagina)
 *   page         aantal pagina's dat deze ronde al is opgehaald
 *   seen         aantal winkels dat deze ronde is langsgekomen
 *   pending      aantal daarvan zonder bekend domein
 *   failures     mislukte stappen op rij
 *   pausedUntil  tot wanneer er na een mislukte stap niets wordt opgehaald
 */
export function newProgress(round = 1) {
  return { round, cursor: null, page: 0, seen: 0, pending: 0, startedAt: null, failures: 0, pausedUntil: 0 };
}

/** Markeert regels als gezien in de gegeven ronde. */
export function stampEntries(entries, round) {
  return entries.map((entry) => ({ ...entry, round }));
}

/**
 * Verwerkt één opgehaalde pagina in de bestaande lijst.
 *
 * @param {{entries: object[], total: number, pending: number}} current  de lijst tot nu toe
 * @param {object} progress  stand van de ronde (zie newProgress)
 * @param {{ids: string[], entries: object[], unknown?: number, next: any}} page
 *        ids: alle winkels op de pagina; entries: de regels voor wie een domein heeft;
 *        unknown: winkels waarvan het domein nog onbekend is; next: bladwijzer voor de
 *        volgende pagina, of null als dit de laatste was
 * @returns {{entries, total, pending, progress, completed: boolean, error: string|null}}
 */
export function applyPage(current, progress, page, now = Date.now()) {
  const fresh = new Map(stampEntries(page.entries, progress.round).map((entry) => [entry.id, entry]));
  const onPage = new Set(page.ids);

  // Bestaande regels blijven op hun plek en krijgen de nieuwe gegevens. Staat een
  // winkel wel op de pagina maar levert hij geen regel meer op (geen domein of geen
  // cashback meer), dan gaat hij er meteen uit. Nieuwe winkels komen achteraan.
  let entries = [];
  for (const entry of current.entries) {
    if (fresh.has(entry.id)) {
      entries.push(fresh.get(entry.id));
      fresh.delete(entry.id);
    } else if (!onPage.has(entry.id)) {
      entries.push(entry);
    }
  }
  entries.push(...fresh.values());

  const seen = progress.seen + onPage.size;
  const pending = progress.pending + (page.unknown || 0);
  const running = { ...progress, failures: 0, pausedUntil: 0, startedAt: progress.startedAt || now };

  if (page.next !== null && page.next !== undefined) {
    return {
      entries,
      total: current.total,
      pending: current.pending,
      completed: false,
      error: null,
      progress: { ...running, cursor: page.next, page: progress.page + 1, seen, pending },
    };
  }

  // Laatste pagina. Zag de ronde veel minder winkels dan er waren, dan is er
  // waarschijnlijk iets mis (pagina's die leeg terugkomen, een gewijzigde site):
  // niets verwijderen en dezelfde ronde opnieuw beginnen.
  if (seen < current.total * MIN_ROUND_SHARE) {
    return {
      entries,
      total: current.total,
      pending: current.pending,
      completed: false,
      error: `Ronde zag maar ${seen} van de ${current.total} winkels; opnieuw begonnen`,
      progress: newProgress(progress.round),
    };
  }

  entries = entries.filter((entry) => (entry.round ?? 0) >= progress.round - 1);
  return {
    entries,
    total: seen,
    pending,
    completed: true,
    error: null,
    progress: { ...newProgress(progress.round + 1), completedAt: now },
  };
}

/**
 * Stand na een mislukte stap: even niets ophalen, en bij herhaling steeds langer
 * wachten (30 minuten, 1 uur, 2 uur, ... tot 6 uur; na een 429 begint het bij 1 uur).
 */
export function failStep(progress, error, now = Date.now()) {
  const failures = (progress.failures || 0) + 1;
  const first = error?.status === 429 ? PAUSE_MINUTES_RATE_LIMIT : PAUSE_MINUTES;
  const minutes = Math.min(first * 2 ** (failures - 1), MAX_PAUSE_MINUTES);
  const next = { ...progress, failures, pausedUntil: now + minutes * MINUTE };

  if (progress.cursor !== null && STALE_CURSOR_STATUSES.includes(error?.status)) {
    Object.assign(next, { cursor: null, page: 0, seen: 0, pending: 0, startedAt: null });
  }
  return next;
}
