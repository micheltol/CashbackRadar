// Haalt de volledige winkellijst opnieuw op en schrijft die naar data/merchants-nl.json,
// voor eigen analyse. De extensie zelf gebruikt dit bestand niet.
// Gebruik: node tools/fetch-merchants.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchAllMerchants } from '../extension/lib/api.js';

const outFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'merchants-nl.json');

const merchants = await fetchAllMerchants({ country: 'NL', delayMs: 200 });
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(merchants, null, 2));
console.log(`${merchants.length} winkels geschreven naar ${outFile}`);
