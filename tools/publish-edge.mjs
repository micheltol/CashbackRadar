// Zet een zip-bestand als nieuwe versie in Microsoft Edge Add-ons, via de Edge Add-ons API (v1.1).
// Wordt door de GitHub-workflow gedraaid na een stabiele release, maar werkt ook lokaal:
//
//   EDGE_PRODUCT_ID=... EDGE_CLIENT_ID=... EDGE_API_KEY=... node tools/publish-edge.mjs dist/CashbackRadar-1.2.0.57.zip
//
// De gegevens staan in Partner Center onder Microsoft Edge > Publish API. De extensie moet daar
// de eerste keer met de hand zijn ingediend; daarna werkt elke update via deze API.
//
// Stappen: pakket uploaden naar de concept-indiening, wachten tot dat verwerkt is, en de
// indiening publiceren (de review van Microsoft volgt daarna). Edge staat maar één indiening
// tegelijk in review toe; loopt er nog een, dan slaat dit script de upload over met een
// waarschuwing in plaats van te mislukken. De volgende release probeert het opnieuw.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://api.addons.microsoftedge.microsoft.com/v1';
const POLL_SECONDS = 5;
const MAX_POLLS = 120; // tien minuten

const { EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID: clientId, EDGE_API_KEY: apiKey } = process.env;
const zipPath = process.argv[2];
const notes = process.env.EDGE_NOTES || `Automatische update: ${basename(zipPath || '')}`;

if (!zipPath) fail('Geef het zip-bestand mee: node tools/publish-edge.mjs <pakket.zip>');
if (!productId || !clientId || !apiKey) fail('EDGE_PRODUCT_ID, EDGE_CLIENT_ID en EDGE_API_KEY zijn verplicht');

const headers = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
const product = `${API}/products/${encodeURIComponent(productId)}`;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function warn(message) {
  console.log(`::warning::${message}`);
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** Start een bewerking; de API antwoordt met 202 en de id van de bewerking in Location. */
async function start(url, { label, ...init }) {
  const response = await fetch(url, { method: 'POST', ...init, headers: { ...headers, ...init.headers } });
  if (response.status !== 202) {
    fail(`${label}: HTTP ${response.status} ${await response.text()}`);
  }
  const operation = response.headers.get('location');
  if (!operation) fail(`${label}: geen bewerkings-id in het antwoord`);
  return operation.split('/').pop();
}

/** Wacht tot een bewerking klaar is en geeft de eindstatus terug. */
async function wait(url, label) {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const response = await fetch(url, { headers });
    if (!response.ok) fail(`${label}: status opvragen gaf HTTP ${response.status} ${await response.text()}`);
    const result = await response.json();
    if (result.status !== 'InProgress') return result;
    await sleep(POLL_SECONDS);
  }
  fail(`${label}: na ${(MAX_POLLS * POLL_SECONDS) / 60} minuten nog niet klaar`);
}

const describe = (result) =>
  [result.errorCode, result.message, ...(result.errors || []).map((error) => error.message || JSON.stringify(error))]
    .filter(Boolean)
    .join(' | ');

const inReview = (result) => /InProgressSubmission|in progress|in review/i.test(describe(result));

// 1. Pakket uploaden.
console.log(`Uploaden: ${zipPath}`);
const uploadId = await start(`${product}/submissions/draft/package`, {
  label: 'Uploaden',
  headers: { 'Content-Type': 'application/zip' },
  body: readFileSync(zipPath),
});
const upload = await wait(`${product}/submissions/draft/package/operations/${uploadId}`, 'Uploaden');
if (upload.status !== 'Succeeded') {
  if (inReview(upload)) {
    warn(`Edge: er loopt nog een indiening in review; deze versie is overgeslagen. (${describe(upload)})`);
    process.exit(0);
  }
  fail(`Uploaden mislukt: ${describe(upload)}`);
}
console.log('Pakket verwerkt.');

// 2. Indiening publiceren.
const publishId = await start(`${product}/submissions`, {
  label: 'Publiceren',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notes }),
});
const publish = await wait(`${product}/submissions/operations/${publishId}`, 'Publiceren');
if (publish.status !== 'Succeeded') {
  if (inReview(publish)) {
    warn(`Edge: er loopt nog een indiening in review; deze versie is overgeslagen. (${describe(publish)})`);
    process.exit(0);
  }
  fail(`Publiceren mislukt: ${describe(publish)}`);
}
console.log(`Ingediend bij Edge Add-ons: ${describe(publish) || 'review gestart'}`);
