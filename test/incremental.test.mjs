// Tests voor het geleidelijk verversen. Draai met: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPage, failStep, newProgress, stampEntries, MIN_ROUND_SHARE } from '../extension/lib/incremental.js';
import { buildIndex, lookup } from '../extension/lib/merchant-index.js';
import { shopbuddies } from '../extension/lib/providers/shopbuddies.js';
import { cashbackxl } from '../extension/lib/providers/cashbackxl.js';

const pct = (value) => ({ type: 'PERCENTAGE', value });
const entry = (id, value, extra = {}) => ({
  id,
  name: id,
  slug: id,
  cashback: pct(value),
  kind: 'cashback',
  deals: 0,
  paths: { [`${id}.nl`]: '' },
  ...extra,
});
const ids = (entries) => entries.map((item) => item.id);

test('applyPage: een pagina werkt bestaande regels bij, haalt vervallen winkels weg en voegt nieuwe toe', () => {
  const current = { entries: stampEntries([entry('a', 1), entry('b', 2), entry('c', 3)], 1), total: 10, pending: 4 };
  const result = applyPage(
    current,
    newProgress(2),
    // b staat nog op de pagina maar levert geen regel meer op; d is nieuw.
    { ids: ['a', 'b', 'd'], entries: [entry('a', 5), entry('d', 7)], unknown: 1, next: 'p2' },
    1000,
  );

  assert.deepEqual(ids(result.entries), ['a', 'c', 'd']);
  assert.deepEqual(result.entries[0].cashback, pct(5));
  assert.deepEqual(
    result.entries.map((item) => item.round),
    [2, 1, 2],
  );
  assert.equal(result.completed, false);
  assert.equal(result.error, null);
  // Totaal en openstaand veranderen pas als de ronde rond is.
  assert.equal(result.total, 10);
  assert.equal(result.pending, 4);
  assert.deepEqual(result.progress, {
    round: 2,
    cursor: 'p2',
    page: 1,
    seen: 3,
    pending: 1,
    startedAt: 1000,
    failures: 0,
    pausedUntil: 0,
  });
  // De invoer blijft ongemoeid.
  assert.deepEqual(current.entries[0].cashback, pct(1));
});

test('applyPage: een winkel verdwijnt pas na twee rondes zonder hem', () => {
  let list = { entries: stampEntries([entry('a', 1), entry('b', 2)], 1), total: 2, pending: 0 };
  let progress = newProgress(2);

  // Ronde 2 en 3 zien alleen a.
  for (const round of [2, 3]) {
    const result = applyPage(list, progress, { ids: ['a', 'x'], entries: [entry('a', 1)], unknown: 1, next: null }, 5000);
    assert.equal(result.completed, true);
    assert.equal(result.total, 2);
    assert.equal(result.pending, 1);
    assert.equal(result.progress.round, round + 1);
    assert.equal(result.progress.cursor, null);
    assert.equal(result.progress.completedAt, 5000);
    assert.deepEqual(ids(result.entries), round === 2 ? ['a', 'b'] : ['a']);
    list = result;
    progress = result.progress;
  }

  // Regels van vóór het geleidelijk verversen hebben geen rondenummer en blijven de eerste ronde staan.
  const legacy = applyPage(
    { entries: [entry('oud', 1), entry('a', 1)], total: 2, pending: 0 },
    newProgress(1),
    { ids: ['a', 'n'], entries: [entry('a', 1)], next: null },
  );
  assert.deepEqual(ids(legacy.entries), ['oud', 'a']);
});

test('applyPage: een ronde die te weinig winkels zag verwijdert niets en begint opnieuw', () => {
  const entries = stampEntries([entry('a', 1), entry('b', 2), entry('c', 3)], 1);
  const seenTooFew = Math.ceil(100 * MIN_ROUND_SHARE) - 2;
  const result = applyPage(
    { entries, total: 100, pending: 0 },
    { ...newProgress(3), cursor: 5, page: 4, seen: seenTooFew },
    { ids: ['a'], entries: [entry('a', 1)], next: null },
  );
  assert.equal(result.completed, false);
  assert.match(result.error, /opnieuw begonnen/);
  assert.deepEqual(ids(result.entries), ['a', 'b', 'c']);
  assert.equal(result.total, 100);
  assert.deepEqual(result.progress, newProgress(3));
});

test('failStep: pauze loopt op, en een ongeldige bladwijzer begint de ronde opnieuw', () => {
  const minute = 60 * 1000;
  const running = { ...newProgress(4), cursor: 'tok', page: 3, seen: 300, startedAt: 1 };

  const first = failStep(running, new Error('netwerk'), 0);
  assert.equal(first.failures, 1);
  assert.equal(first.pausedUntil, 30 * minute);
  assert.equal(first.cursor, 'tok'); // dezelfde pagina wordt later opnieuw geprobeerd
  assert.equal(failStep(first, new Error('netwerk'), 0).pausedUntil, 60 * minute);

  const limited = failStep(running, Object.assign(new Error('te veel'), { status: 429 }), 0);
  assert.equal(limited.pausedUntil, 60 * minute);
  assert.equal(failStep({ ...running, failures: 9 }, new Error('netwerk'), 0).pausedUntil, 6 * 60 * minute);

  const stale = failStep(running, Object.assign(new Error('invalid page token'), { status: 400 }), 0);
  assert.deepEqual(
    { round: stale.round, cursor: stale.cursor, page: stale.page, seen: stale.seen },
    { round: 4, cursor: null, page: 0, seen: 0 },
  );

  // Een geslaagde stap wist de pauze weer.
  const recovered = applyPage(
    { entries: [], total: 0, pending: 0 },
    first,
    { ids: ['a'], entries: [entry('a', 1)], next: 'verder' },
  );
  assert.equal(recovered.progress.failures, 0);
  assert.equal(recovered.progress.pausedUntil, 0);
});

test('ShopBuddies: loadPage volgt de bladwijzer en meldt het einde', async () => {
  const merchant = (id, site) => ({
    id,
    name: id,
    websiteUrl: site,
    cashbackAmount: { amount: { value: 250, scalingFactor: 2 }, amountType: 'PERCENTAGE' },
  });
  const pages = {
    '': { data: { merchants: [merchant('a', 'https://a.nl'), merchant('b', '')] }, meta: { pagination: { nextToken: 't1' } } },
    t1: { data: { merchants: [merchant('c', 'https://c.nl')] }, meta: { pagination: {} } },
  };
  const calls = [];
  const fakeFetch = async (url) => {
    const token = new URL(url).searchParams.get('pageToken') || '';
    calls.push(token);
    if (!(token in pages)) return { ok: false, status: 400 };
    return { ok: true, status: 200, json: async () => pages[token] };
  };

  const first = await shopbuddies.loadPage({ fetchImpl: fakeFetch });
  assert.deepEqual(first.ids, ['a', 'b']);
  assert.deepEqual(ids(first.entries), ['a']); // b heeft geen website
  assert.equal(first.next, 't1');

  const last = await shopbuddies.loadPage({ cursor: first.next, fetchImpl: fakeFetch });
  assert.deepEqual(last.ids, ['c']);
  assert.equal(last.next, null);
  assert.deepEqual(calls, ['', 't1']);

  await assert.rejects(shopbuddies.loadPage({ cursor: 'verlopen', fetchImpl: fakeFetch }), (error) => error.status === 400);
});

test('CashbackXL: loadPage haalt één lijstpagina en leert hooguit een paar domeinen bij', async () => {
  const listHtml = (shops) =>
    shops
      .map(
        ([slug, amountText]) =>
          `<a class="border-box-filter" href="/webshops/${slug}"><span class="filter">${slug}</span><span class="filter">${amountText}</span><span class="filter">1</span></a>`,
      )
      .join('');
  const lists = {
    1: [['surfshark', '60,00%'], ['nieuw-1', '5,00%'], ['nieuw-2', '4,00%']],
    2: [['coolblue', '2,25%']],
  };
  const requested = [];
  let limited = false;
  const fakeFetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    requested.push(pathname + (searchParams.get('p') ? `?p=${searchParams.get('p')}` : ''));
    if (limited) return { ok: false, status: 429, headers: new Headers() };
    const respond = (html) => ({ ok: true, status: 200, text: async () => html, headers: new Headers() });
    if (pathname.startsWith('/zoeken/')) return respond(listHtml(lists[searchParams.get('p')] || []));
    return respond(`<span class="domain">op ${pathname.split('/').pop()}.nl</span>`);
  };
  const seed = { surfshark: { d: 'surfshark.com' }, coolblue: { d: 'coolblue.nl', v: 1 } };

  const first = await cashbackxl.loadPage({ fetchImpl: fakeFetch, seed, learned: {}, maxDetails: 1, delayMs: 0 });
  assert.deepEqual(first.ids, ['surfshark', 'nieuw-1', 'nieuw-2']);
  assert.deepEqual(ids(first.entries), ['surfshark', 'nieuw-1']);
  assert.equal(first.unknown, 1); // nieuw-2 komt een volgende ronde
  assert.equal(first.next, 2);
  assert.deepEqual(first.state.learned, { 'nieuw-1': { d: 'nieuw-1.nl' } });
  assert.deepEqual(requested, ['/zoeken/%25?p=1', '/webshops/nieuw-1']);

  const second = await cashbackxl.loadPage({ cursor: 2, fetchImpl: fakeFetch, seed, learned: first.state.learned, delayMs: 0 });
  assert.deepEqual(ids(second.entries), ['coolblue']);
  assert.equal(second.entries[0].kind, 'voucher');
  assert.equal(second.next, 3);

  const beyond = await cashbackxl.loadPage({ cursor: 3, fetchImpl: fakeFetch, seed, delayMs: 0 });
  assert.deepEqual(beyond.ids, []);
  assert.equal(beyond.next, null);

  // Bij een verzoekgrens wacht een stap niet: één verzoek, daarna direct een fout.
  limited = true;
  requested.length = 0;
  await assert.rejects(
    cashbackxl.loadPage({ cursor: 1, fetchImpl: fakeFetch, seed, delayMs: 0 }),
    (error) => error.status === 429,
  );
  assert.deepEqual(requested, ['/zoeken/%25?p=1']);
});

test('twee rondes pagina voor pagina geven dezelfde lijst als alles in één keer', async () => {
  // Een aanbieder met vijf winkels op pagina's van twee; tussen de rondes verandert de lijst.
  let shops = [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4), entry('e', 5)];
  const provider = {
    async loadPage({ cursor = null }) {
      const start = cursor || 0;
      const slice = shops.slice(start, start + 2);
      const next = start + 2 < shops.length ? start + 2 : null;
      return { ids: ids(slice), entries: slice, unknown: 0, next };
    },
  };
  const runRound = async (list, progress) => {
    let steps = 0;
    for (;;) {
      const result = applyPage(list, progress, await provider.loadPage({ cursor: progress.cursor }));
      steps++;
      list = result;
      progress = result.progress;
      if (result.completed) return { list, progress, steps };
    }
  };

  let state = { list: { entries: stampEntries(shops, 1), total: 5, pending: 0 }, progress: newProgress(2) };

  shops = [entry('a', 1), entry('c', 9), entry('d', 4), entry('e', 5), entry('f', 6)]; // b weg, c hoger, f nieuw
  state = await runRound(state.list, state.progress);
  assert.equal(state.steps, 3);
  assert.equal(state.list.total, 5);
  // b staat er na één ronde nog; c en f zijn al bijgewerkt.
  assert.deepEqual(ids(state.list.entries).sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
  const index = buildIndex(state.list.entries, state.list.total);
  assert.deepEqual(lookup(index, 'https://c.nl/').matches[0].cashback, pct(9));
  assert.equal(lookup(index, 'https://f.nl/').matches[0].id, 'f');

  state = await runRound(state.list, state.progress);
  assert.deepEqual(ids(state.list.entries).sort(), ids(shops).sort());
  assert.equal(state.progress.round, 4);
  assert.equal(lookup(buildIndex(state.list.entries), 'https://b.nl/'), null);
});
