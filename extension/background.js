// Service worker: houdt de winkellijsten vers en zet per tab het icoon en de badge.
//
// Verversen gaat geleidelijk: een aanbieder zonder lijst wordt één keer volledig
// opgehaald, daarna komt er elke STEP_MINUTES minuten één pagina per aanbieder bij
// (zie lib/incremental.js). Zo krijgt een site nooit een reeks verzoeken achter elkaar.

import { PROVIDERS, providerById, normalizeSettings } from './lib/providers/index.js';
import { buildIndex, lookup, INDEX_VERSION } from './lib/merchant-index.js';
import { combine } from './lib/compare.js';
import { badgeFor } from './lib/format.js';
import { applyPage, failStep, newProgress, stampEntries } from './lib/incremental.js';

const STEP_ALARM = 'refresh-step';
const OLD_DAILY_ALARM = 'refresh-merchants'; // versie 1.1 en ouder
const RETRY_ALARM_PREFIX = 'retry:';
// Eén pagina per aanbieder per stap: met 27 en 29 pagina's duurt een ronde ongeveer
// een half uur dat de browser open staat.
const STEP_MINUTES = 1;
const RETRY_MINUTES = 2;
const MIN_EXPECTED_ENTRIES = 50;
const DEFAULT_TITLE = 'CashbackRadar';

const ICONS = {
  active: { 16: 'icons/active-16.png', 32: 'icons/active-32.png', 48: 'icons/active-48.png' },
  inactive: { 16: 'icons/inactive-16.png', 32: 'icons/inactive-32.png', 48: 'icons/inactive-48.png' },
};

const dataKey = (id) => `data:${id}`;
const stateKey = (id) => `state:${id}`;
const labelOf = (id) => providerById(id)?.label ?? id;

// De worker wordt regelmatig afgesloten; dit is alleen een cache van de opslag.
let cache = null;
const refreshes = new Map(); // aanbieder-id -> lopende verversing of stap

async function loadState() {
  if (cache) return cache;
  const stored = await chrome.storage.local.get(['settings', ...PROVIDERS.map((p) => dataKey(p.id))]);
  const data = {};
  for (const provider of PROVIDERS) {
    const item = stored[dataKey(provider.id)];
    const usable = item?.index?.version === INDEX_VERSION;
    data[provider.id] = {
      index: usable ? item.index : null,
      updatedAt: usable ? item.updatedAt || null : null,
      pending: usable ? item.pending || 0 : 0,
      lastError: item?.lastError || null,
      progress: usable ? item.progress || null : null,
    };
  }
  cache = { settings: normalizeSettings(stored.settings), data };
  return cache;
}

const isEnabled = (state, id) => state.settings.providers[id] === true;

async function loadSeed(provider) {
  if (!provider.seedFile) return undefined;
  try {
    const response = await fetch(chrome.runtime.getURL(provider.seedFile));
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
}

const storedState = async (id) => (await chrome.storage.local.get(stateKey(id)))[stateKey(id)] || {};

/** Haalt de hele lijst van een aanbieder in één keer op (de eerste keer, of op verzoek). */
function refreshProvider(id) {
  if (refreshes.has(id)) return refreshes.get(id);
  const provider = providerById(id);

  const run = (async () => {
    const state = await loadState();
    try {
      const loaded = await provider.load({ ...(await storedState(id)), seed: await loadSeed(provider) });
      if (loaded.entries.length < MIN_EXPECTED_ENTRIES) {
        throw new Error(`${provider.label} gaf maar ${loaded.entries.length} winkels; oude lijst behouden`);
      }
      // De volledige lijst telt als een afgeronde ronde; de volgende begint bij pagina 1.
      const round = state.data[id].progress?.round ?? 1;
      const item = {
        index: buildIndex(stampEntries(loaded.entries, round), loaded.total),
        updatedAt: Date.now(),
        pending: loaded.pending || 0,
        lastError: null,
        progress: newProgress(round + 1),
      };
      const writes = { [dataKey(id)]: item };
      if (loaded.state) writes[stateKey(id)] = loaded.state;
      await chrome.storage.local.set(writes);
      state.data[id] = item;
      chrome.alarms.clear(RETRY_ALARM_PREFIX + id);
      await updateAllTabs();
      return { id, ok: true };
    } catch (error) {
      const lastError = { message: String(error?.message || error), at: Date.now() };
      state.data[id] = { ...state.data[id], lastError };
      const previous = (await chrome.storage.local.get(dataKey(id)))[dataKey(id)] || {};
      await chrome.storage.local.set({ [dataKey(id)]: { ...previous, lastError } });
      // Eén nieuwe poging later; daarna probeert elke stap het opnieuw zolang de lijst ontbreekt.
      chrome.alarms.create(RETRY_ALARM_PREFIX + id, { delayInMinutes: RETRY_MINUTES });
      return { id, ok: false, error: lastError.message };
    } finally {
      refreshes.delete(id);
    }
  })();

  refreshes.set(id, run);
  return run;
}

/**
 * Haalt de volgende pagina van een aanbieder op en werkt de lijst ermee bij.
 * Met force wordt de pauze na een eerdere mislukte stap genegeerd.
 */
function stepProvider(id, { force = false } = {}) {
  if (refreshes.has(id)) return refreshes.get(id);
  const provider = providerById(id);

  const run = (async () => {
    try {
      const state = await loadState();
      const data = state.data[id];
      const progress = data.progress || newProgress();
      if (!data.index) return { id, ok: false, skipped: 'geen lijst' };
      if (!force && progress.pausedUntil > Date.now()) return { id, ok: true, skipped: 'pauze' };

      let item;
      let outcome;
      const writes = {};
      try {
        const page = await provider.loadPage({
          ...(await storedState(id)),
          seed: await loadSeed(provider),
          cursor: progress.cursor,
        });
        const now = Date.now();
        const result = applyPage(
          { entries: data.index.entries, total: data.index.total, pending: data.pending },
          progress,
          page,
          now,
        );
        item = {
          index: buildIndex(result.entries, result.total),
          updatedAt: now,
          pending: result.pending,
          lastError: result.error ? { message: result.error, at: now } : null,
          progress: result.progress,
        };
        if (page.state) writes[stateKey(id)] = page.state;
        outcome = {
          id,
          ok: !result.error,
          page: progress.page + 1,
          shops: page.ids.length,
          completed: result.completed,
          ...(result.error ? { error: result.error } : {}),
        };
      } catch (error) {
        const now = Date.now();
        const lastError = { message: String(error?.message || error), at: now };
        item = { ...data, lastError, progress: failStep(progress, error, now) };
        outcome = { id, ok: false, error: lastError.message };
      }

      writes[dataKey(id)] = item;
      await chrome.storage.local.set(writes);
      state.data[id] = item;
      if (outcome.ok) await updateAllTabs();
      return outcome;
    } finally {
      refreshes.delete(id);
    }
  })();

  refreshes.set(id, run);
  return run;
}

/** Volledige verversing van alle ingeschakelde aanbieders (de knop in de popup). */
async function refreshAll() {
  const state = await loadState();
  return Promise.all(
    PROVIDERS.filter((provider) => isEnabled(state, provider.id)).map((provider) => refreshProvider(provider.id)),
  );
}

/** Haalt de lijst op van ingeschakelde aanbieders die er nog geen hebben. */
async function loadMissing() {
  const state = await loadState();
  const due = PROVIDERS.filter((provider) => {
    if (!isEnabled(state, provider.id)) return false;
    const { index, lastError } = state.data[provider.id];
    // Na een mislukte poging niet bij elke aanleiding opnieuw proberen.
    if (lastError && Date.now() - lastError.at < RETRY_MINUTES * 60 * 1000) return false;
    return !index;
  });
  return Promise.all(due.map((provider) => refreshProvider(provider.id)));
}

/** Eén stap per ingeschakelde aanbieder: de volgende pagina, of de hele lijst als die ontbreekt. */
async function stepEnabled(options) {
  const state = await loadState();
  const withList = PROVIDERS.filter((provider) => isEnabled(state, provider.id) && state.data[provider.id].index);
  const [steps] = await Promise.all([
    Promise.all(withList.map((provider) => stepProvider(provider.id, options))),
    loadMissing(),
  ]);
  return steps;
}

async function ensureAlarm() {
  chrome.alarms.clear(OLD_DAILY_ALARM);
  const existing = await chrome.alarms.get(STEP_ALARM);
  if (existing?.periodInMinutes !== STEP_MINUTES) {
    chrome.alarms.create(STEP_ALARM, { periodInMinutes: STEP_MINUTES });
  }
}

function lookupAll(state, url) {
  if (!url) return null;
  const lookups = PROVIDERS.filter((provider) => isEnabled(state, provider.id) && state.data[provider.id].index).map(
    (provider) => ({ provider, result: lookup(state.data[provider.id].index, url) }),
  );
  return combine(lookups);
}

async function updateTab(tabId, url) {
  const combined = lookupAll(await loadState(), url);
  try {
    if (combined) {
      const badge = badgeFor(combined, labelOf);
      await Promise.all([
        chrome.action.setIcon({ tabId, path: ICONS.active }),
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' }),
        chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }),
        chrome.action.setBadgeText({ tabId, text: badge.text }),
        chrome.action.setTitle({ tabId, title: badge.title }),
      ]);
    } else {
      await Promise.all([
        chrome.action.setIcon({ tabId, path: ICONS.inactive }),
        chrome.action.setBadgeText({ tabId, text: '' }),
        chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }),
      ]);
    }
  } catch {
    // De tab is intussen gesloten; niets te doen.
  }
}

async function updateAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => updateTab(tab.id, tab.url)));
}

async function statusFor(url) {
  const state = await loadState();
  return {
    combined: lookupAll(state, url),
    stepMinutes: STEP_MINUTES,
    providers: PROVIDERS.map((provider) => {
      const data = state.data[provider.id];
      return {
        id: provider.id,
        label: provider.label,
        enabled: isEnabled(state, provider.id),
        hasData: Boolean(data.index),
        updatedAt: data.updatedAt,
        total: data.index?.total ?? 0,
        matchable: data.index?.entries.length ?? 0,
        pending: data.pending,
        lastError: data.lastError,
        refreshing: refreshes.has(provider.id),
        // Voortgang van de lopende ronde, voor de regel onderaan de popup.
        page: data.progress?.page ?? 0,
        pages: data.index && provider.pageSize ? Math.ceil(data.index.total / provider.pageSize) : 0,
        pausedUntil: data.progress?.pausedUntil || 0,
      };
    }),
  };
}

async function setProviders(providers) {
  const state = await loadState();
  state.settings = normalizeSettings({ providers: { ...state.settings.providers, ...providers } });
  await chrome.storage.local.set({ settings: state.settings });
  await updateAllTabs();
  loadMissing(); // een net ingeschakelde aanbieder heeft nog geen lijst
}

// Ook bij elke start van de worker, voor het geval het alarm verdwenen is.
ensureAlarm();

chrome.runtime.onInstalled.addListener(async () => {
  // Sleutels van versie 1.0, toen er één aanbieder was.
  await chrome.storage.local.remove(['index', 'updatedAt', 'lastError']);
  await ensureAlarm();
  await updateAllTabs();
  await loadMissing();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await updateAllTabs();
  await loadMissing();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === STEP_ALARM) {
    await stepEnabled();
  } else if (alarm.name.startsWith(RETRY_ALARM_PREFIX)) {
    const id = alarm.name.slice(RETRY_ALARM_PREFIX.length);
    const state = await loadState();
    // Alleen als de lijst nog steeds ontbreekt; anders doen de stappen het werk.
    if (providerById(id) && isEnabled(state, id) && !state.data[id].index) await refreshProvider(id);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // De badge van een tab verdwijnt bij navigatie, dus zet hem bij elke stap opnieuw.
  if (changeInfo.url || changeInfo.status) updateTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateTab(tabId, tab.url);
  } catch {
    // Tab bestaat niet meer.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'status':
        loadMissing(); // haalt een ontbrekende lijst alsnog op
        sendResponse(await statusFor(message.url));
        break;
      case 'refresh':
        sendResponse(await refreshAll());
        break;
      case 'step':
        // Handmatig één stap zetten, om het geleidelijk verversen te kunnen bekijken.
        sendResponse(await stepEnabled({ force: true }));
        break;
      case 'setProviders':
        await setProviders(message.providers || {});
        sendResponse(await statusFor(message.url));
        break;
      default:
        sendResponse(null);
    }
  })();
  return true; // antwoord volgt asynchroon
});
