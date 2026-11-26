// Opzoektabel (domein -> winkels) voor één aanbieder, en het zoeken daarin.
// De regels komen van de aanbieder-modules in lib/providers; dit is de plek om
// andere matchpatronen toe te voegen.
//
// Een regel ziet er zo uit:
//   { id, name, slug, cashback: { type: 'PERCENTAGE'|'FIXED', value, upTo? } | null,
//     kind: 'cashback'|'voucher', deals, paths: { domein: pad }, ...extra's }

import { hostFromUrl, candidateHosts, pathStartsWith } from './domains.js';

export const INDEX_VERSION = 2;

/**
 * @param {object[]} entries  regels met minstens één domein in `paths`
 * @param {number} total      aantal winkels bij de aanbieder, ook die zonder domein
 */
export function buildIndex(entries, total = entries.length) {
  const hosts = {};
  entries.forEach((entry, position) => {
    for (const host of Object.keys(entry.paths)) {
      (hosts[host] ||= []).push(position);
    }
  });
  return { version: INDEX_VERSION, total, entries, hosts };
}

/**
 * Zoekt de winkels die bij een tab-URL horen.
 * Geeft null als er niets is, anders { host, matches } met de beste match eerst.
 */
export function lookup(index, url) {
  if (!index?.hosts) return null;
  const parsed = hostFromUrl(url);
  if (!parsed) return null;

  for (const host of candidateHosts(parsed.host)) {
    const positions = index.hosts[host];
    if (!positions) continue;

    const matches = positions
      .map((position) => {
        const entry = index.entries[position];
        const ownPath = entry.paths[host] || '';
        const pathMatch = ownPath !== '' && pathStartsWith(parsed.path, ownPath);
        // Een winkel waarvan het pad klopt gaat voor (langste pad eerst), dan de
        // winkels die voor het hele domein gelden, dan de rest van het domein.
        const rank = pathMatch ? 2 + ownPath.length / 1000 : ownPath === '' ? 1 : 0;
        return { ...entry, pathMatch, rank };
      })
      .sort((a, b) => b.rank - a.rank || b.deals - a.deals || a.name.localeCompare(b.name, 'nl'));

    return { host, matches };
  }
  return null;
}
