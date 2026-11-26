import { shopbuddies } from './shopbuddies.js';
import { cashbackxl } from './cashbackxl.js';

// De volgorde is de voorkeur: bij gelijke cashback wint de eerste.
export const PROVIDERS = [shopbuddies, cashbackxl];

export const providerById = (id) => PROVIDERS.find((provider) => provider.id === id);

export const DEFAULT_SETTINGS = {
  providers: Object.fromEntries(PROVIDERS.map((provider) => [provider.id, true])),
};

/** Vult ontbrekende waarden aan, zodat een later toegevoegde aanbieder standaard aan staat. */
export function normalizeSettings(stored) {
  const providers = { ...DEFAULT_SETTINGS.providers };
  for (const provider of PROVIDERS) {
    if (typeof stored?.providers?.[provider.id] === 'boolean') {
      providers[provider.id] = stored.providers[provider.id];
    }
  }
  return { providers };
}
