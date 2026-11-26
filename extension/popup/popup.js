import { formatCashback } from '../lib/format.js';
import { providerById } from '../lib/providers/index.js';
import { hostFromUrl } from '../lib/domains.js';

const siteEl = document.getElementById('site');
const contentEl = document.getElementById('content');
const sourcesEl = document.getElementById('sources');
const refreshButton = document.getElementById('refresh');

const dateFormat = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat('nl-NL', { timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const countFormat = new Intl.NumberFormat('nl-NL');

/** Kort tijdstip voor de statusregel: vandaag alleen de tijd, anders ook de dag. */
function whenText(timestamp) {
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dayFormat.format(date);
}

// Winkelnamen komen van buiten: altijd als tekst plaatsen, nooit als HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openTab(url) {
  chrome.tabs.create({ url });
  window.close();
}

function linkButton(text, url) {
  const button = el('button', 'link', text);
  button.type = 'button';
  button.addEventListener('click', () => openTab(url));
  return button;
}

const labelOf = (offer) => providerById(offer.providerId).label;
const urlOf = (offer) => providerById(offer.providerId).entryUrl(offer);

function amountText(offer) {
  const text = formatCashback(offer.cashback);
  return offer.kind === 'voucher' ? `${text} voucher` : text;
}

function detailsOf(offer) {
  const details = [];
  if (offer.kind === 'voucher') details.push('tegoed voor een voucher, geen geld');
  if (offer.cashback?.type === 'POINTS') details.push('spaarpunten, geen bedrag');
  if (offer.stockPoints) details.push(`+ ${formatCashback(offer.stockPoints)} Stock Points`);
  if (offer.deals > 1) details.push(`${offer.deals} deals`);
  if (offer.autoReward) details.push('Autorewards');
  if (offer.pathMatch) details.push('past bij deze pagina');
  return details.join(' · ');
}

function verdictText(combined) {
  if (combined.ambiguous) return 'Meerdere aanbiedingen';
  const other = combined.others.find((offer) => offer.providerId !== combined.best.providerId);
  switch (combined.verdict) {
    case 'better':
      return 'Beste deal';
    case 'equal':
      return `Gelijk aan ${labelOf(other)}`;
    case 'incomparable':
      return `Niet direct te vergelijken met ${labelOf(other)}`;
    default:
      return null;
  }
}

function renderHero(combined) {
  const offer = combined.best;
  const hero = el('section', 'hero');

  const verdict = verdictText(combined);
  if (verdict) hero.append(el('p', 'verdict', verdict));

  const head = el('div', 'offer-head');
  head.append(el('span', 'chip', labelOf(offer)), el('span', 'name', offer.name));
  hero.append(head, el('span', 'amount', amountText(offer)));

  const details = detailsOf(offer);
  if (details) hero.append(el('p', 'details', details));
  if (offer.lowReliability) {
    hero.append(el('p', 'warning', 'ShopBuddies markeert de registratie bij deze winkel als minder betrouwbaar.'));
  }

  const button = el('button', 'primary', `Open bij ${labelOf(offer)}`);
  button.type = 'button';
  button.addEventListener('click', () => openTab(urlOf(offer)));
  hero.append(button);
  return hero;
}

function renderRow(offer) {
  const row = el('section', 'row');

  const head = el('div', 'offer-head');
  const title = el('div', 'offer-head');
  title.append(el('span', 'chip', labelOf(offer)), el('span', 'name', offer.name));
  head.append(title, el('span', 'amount', amountText(offer)));

  const foot = el('div', 'row-foot');
  foot.append(el('p', 'details', detailsOf(offer)), linkButton(`Open bij ${labelOf(offer)}`, urlOf(offer)));

  row.append(head, foot);
  return row;
}

function renderContent(status, tabUrl) {
  const parsed = hostFromUrl(tabUrl || '');
  siteEl.textContent = parsed ? parsed.host : 'Geen webpagina';
  contentEl.replaceChildren();

  const enabled = status.providers.filter((provider) => provider.enabled);
  const ready = enabled.filter((provider) => provider.hasData);
  const loading = enabled.filter((provider) => !provider.hasData && !provider.lastError);

  if (enabled.length === 0) {
    contentEl.append(el('p', 'empty', 'Er staat geen aanbieder aan. Vink er hieronder minstens één aan.'));
    return;
  }

  if (status.combined) {
    contentEl.append(renderHero(status.combined));
    if (status.combined.others.length) {
      contentEl.append(el('h2', '', 'Andere aanbiedingen'));
      for (const offer of status.combined.others) contentEl.append(renderRow(offer));
    }
    contentEl.append(el('p', 'note', 'Cashback telt alleen als je via de aanbieder naar de winkel doorklikt.'));
  } else if (ready.length === 0) {
    const failed = enabled.find((provider) => provider.lastError);
    contentEl.append(
      el(
        'p',
        'empty',
        failed && loading.length === 0
          ? `De winkellijst kon niet worden opgehaald: ${failed.lastError.message}`
          : 'De winkellijsten worden opgehaald. Dit kan een minuut duren.',
      ),
    );
  } else {
    contentEl.append(
      el('p', 'empty', parsed ? 'Geen cashback gevonden voor deze site.' : 'Open een webwinkel om te controleren.'),
    );
    const links = el('div', 'links');
    for (const provider of ready) {
      links.append(linkButton(`Zoeken op ${provider.label}`, providerById(provider.id).home));
    }
    contentEl.append(links);
  }

  if (loading.length && ready.length) {
    contentEl.append(
      el('p', 'note', `${loading.map((provider) => provider.label).join(' en ')} wordt nog geladen.`),
    );
  }
}

function sourceState(provider) {
  if (!provider.enabled) return { text: 'uit' };
  if (provider.refreshing && !provider.hasData) return { text: 'wordt geladen…' };
  if (!provider.hasData) {
    return provider.lastError ? { text: 'ophalen mislukt', error: true } : { text: 'nog geen lijst' };
  }
  const when = provider.updatedAt ? whenText(provider.updatedAt) : 'onbekend';
  let text = `${countFormat.format(provider.total)} winkels · ${when}`;
  // De lijst wordt in delen ververst; dit is hoe ver de lopende ronde is.
  if (provider.page > 0 && provider.pages > 0) {
    text += ` · deel ${Math.min(provider.page, provider.pages)}/${provider.pages}`;
  }
  if (provider.lastError) return { text: `${text} · verversen mislukt`, error: true };
  if (provider.pending) text += ` · ${countFormat.format(provider.pending)} nog zonder domein`;
  return { text };
}

function sourceHint(provider, status) {
  if (provider.lastError) {
    const resume =
      provider.pausedUntil > Date.now() ? ` Volgende poging na ${dateFormat.format(new Date(provider.pausedUntil))}.` : '';
    return `${provider.lastError.message}.${resume}`;
  }
  if (!provider.enabled || !provider.hasData) return '';
  const last = provider.updatedAt ? ` Laatste deel: ${dateFormat.format(new Date(provider.updatedAt))}.` : '';
  const pace = status.stepMinutes === 1 ? 'elke minuut' : `elke ${status.stepMinutes} minuten`;
  return `Wordt geleidelijk ververst: ${pace} één deel van de lijst.${last}`;
}

function renderSources(status, tabUrl) {
  sourcesEl.replaceChildren();
  for (const provider of status.providers) {
    const item = el('li');
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = provider.enabled;
    box.addEventListener('change', async () => {
      box.disabled = true;
      const next = await chrome.runtime.sendMessage({
        type: 'setProviders',
        providers: { [provider.id]: box.checked },
        url: tabUrl,
      });
      render(next, tabUrl);
      scheduleReload(next);
    });

    const state = sourceState(provider);
    const text = el('span');
    text.append(el('strong', '', provider.label), ' ', el('span', state.error ? 'state error' : 'state', state.text));
    text.title = sourceHint(provider, status);
    label.append(box, text);
    item.append(label);
    sourcesEl.append(item);
  }
}

function render(status, tabUrl) {
  renderContent(status, tabUrl);
  renderSources(status, tabUrl);
}

async function currentTabUrl() {
  // popup.html?url=https://... controleert een opgegeven adres; handig om te testen.
  const override = new URLSearchParams(location.search).get('url');
  if (override) return override;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

let reloadTimer = null;

// Zolang een ingeschakelde aanbieder nog geen lijst heeft, kijken we even later opnieuw.
function scheduleReload(status) {
  clearTimeout(reloadTimer);
  const waiting = status.providers.some(
    (provider) => provider.enabled && !provider.hasData && !provider.lastError,
  );
  if (waiting) reloadTimer = setTimeout(load, 2500);
}

async function load() {
  const tabUrl = await currentTabUrl();
  const status = await chrome.runtime.sendMessage({ type: 'status', url: tabUrl });
  render(status, tabUrl);
  scheduleReload(status);
}

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = 'Bezig… (kan een minuut duren)';
  await chrome.runtime.sendMessage({ type: 'refresh' });
  refreshButton.disabled = false;
  refreshButton.textContent = 'Lijsten vernieuwen';
  await load();
});

load();
