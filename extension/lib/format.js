// Cashbackbedragen leesbaar maken.
// Een bedrag is { type: 'PERCENTAGE'|'FIXED'|'POINTS', value, upTo? } of null.

const number = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Volledige tekst voor de popup: "1,75%", "tot 7,5%", "€ 25", of "cashback". */
export function formatCashback(amount) {
  if (!amount) return 'cashback';
  const prefix = amount.upTo ? 'tot ' : '';
  if (amount.type === 'PERCENTAGE') return `${prefix}${number.format(amount.value)}%`;
  if (amount.type === 'FIXED') {
    const euros = Number.isInteger(amount.value) ? number.format(amount.value) : money.format(amount.value);
    return `${prefix}€ ${euros}`;
  }
  if (amount.type === 'POINTS') return `${prefix}${number.format(amount.value)} punten`;
  return 'cashback';
}

/**
 * Korte tekst voor op het icoon (maximaal vier tekens). Rondt naar beneden af,
 * zodat het icoon nooit meer belooft dan de winkel geeft.
 */
export function badgeText(amount) {
  if (!amount) return '✓';
  if (amount.type === 'FIXED') {
    const euros = Math.floor(amount.value);
    if (euros < 1) return '€';
    return euros < 1000 ? `€${euros}` : '€€€';
  }
  if (amount.type === 'PERCENTAGE') {
    if (amount.value < 10 && !Number.isInteger(amount.value)) {
      const tenths = Math.floor(amount.value * 10 + 1e-9) / 10;
      return `${tenths.toFixed(1).replace('.', ',')}%`;
    }
    return `${Math.floor(amount.value + 1e-9)}%`;
  }
  if (amount.type === 'POINTS') return 'pnt';
  return '✓';
}

/**
 * Badge en tooltip voor een samengevoegd resultaat (zie compare.js). Als de gekozen
 * aanbieder meerdere winkels heeft die even goed bij de pagina passen (bijvoorbeeld
 * tien verzekeringen op één domein) tonen we het aantal in plaats van een willekeurig
 * bedrag.
 *
 * @param {object} combined       uitkomst van combine()
 * @param {(id:string)=>string} labelOf  naam van een aanbieder
 */
export function badgeFor(combined, labelOf) {
  if (combined.ambiguous) {
    return {
      text: combined.count > 99 ? '99+' : `${combined.count}×`,
      title: `Cashback: ${combined.count} aanbiedingen voor ${combined.host}`,
    };
  }
  const { best } = combined;
  const describe = (offer) => `${labelOf(offer.providerId)} ${formatCashback(offer.cashback)}`;
  const elsewhere = combined.others.find((offer) => offer.providerId !== best.providerId);
  const comparison = elsewhere ? ` (${describe(elsewhere)})` : '';
  return {
    text: badgeText(best.cashback),
    title: `${best.name}: ${describe(best)}${comparison}`,
  };
}
