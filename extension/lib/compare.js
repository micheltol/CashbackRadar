// Voegt de zoekresultaten van meerdere aanbieders samen en kiest de beste deal.

/**
 * Vergelijkt twee bedragen. Positief als `a` beter is, negatief als `b` beter is,
 * 0 bij gelijk, en null als ze niet te vergelijken zijn (procent tegenover euro's
 * of punten, of een van beide onbekend).
 */
export function compareAmounts(a, b) {
  if (!a || !b || a.type !== b.type) return null;
  return a.value - b.value;
}

/**
 * @param {{provider: {id:string,label:string}, result: {host:string, matches:object[]}|null}[]} lookups
 *        in voorkeursvolgorde; bij gelijke of onvergelijkbare cashback wint de eerste
 * @returns null als geen enkele aanbieder iets heeft, anders:
 *   best      de aanbieding die bovenaan komt, met `providerId`
 *   verdict   'only' (één aanbieder), 'better', 'equal' of 'incomparable'
 *   others    alle overige aanbiedingen: eerst de beste van de andere aanbieders
 *   ambiguous waar als de gekozen aanbieder meerdere aanbiedingen heeft die even goed
 *             bij de pagina passen; `best` is dan een willekeurige daarvan
 */
export function combine(lookups) {
  const found = lookups.filter((item) => item.result?.matches.length);
  if (found.length === 0) return null;

  const tag = (item, match) => ({ ...match, providerId: item.provider.id });
  const tops = found.map((item) => {
    const [first, second] = item.result.matches;
    return { offer: tag(item, first), ambiguous: Boolean(second) && second.rank === first.rank };
  });

  // Stabiel sorteren, zodat de voorkeursvolgorde blijft staan tenzij er een reden is:
  // een aanbieder met één duidelijke aanbieding gaat voor een aanbieder met meerdere
  // gelijkwaardige (daar is "de beste" willekeurig), en daarna telt het hoogste bedrag.
  const ordered = [...tops].sort((a, b) => {
    if (a.ambiguous !== b.ambiguous) return a.ambiguous ? 1 : -1;
    return compareAmounts(b.offer.cashback, a.offer.cashback) ?? 0;
  });
  const [best, runnerUp] = ordered;

  let verdict = 'only';
  if (runnerUp) {
    const difference =
      best.ambiguous || runnerUp.ambiguous ? null : compareAmounts(best.offer.cashback, runnerUp.offer.cashback);
    verdict = difference === null ? 'incomparable' : difference === 0 ? 'equal' : 'better';
  }

  const rest = found.flatMap((item) => item.result.matches.slice(1).map((match) => tag(item, match)));

  return {
    host: found[0].result.host,
    best: best.offer,
    verdict,
    others: [...ordered.slice(1).map((top) => top.offer), ...rest],
    ambiguous: best.ambiguous,
    count: tops.length + rest.length,
  };
}
