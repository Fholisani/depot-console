import { InjectionToken } from '@angular/core';

/**
 * Runtime configuration, read from `config.json` next to `index.html` before the app starts.
 * One build serves every slot and environment (Requirement 21.24): nothing here is baked in.
 */
export interface AppConfig {
  /** Base of the Depot API, e.g. `/depot` (same origin) or `https://fmash.online/depot`. */
  apiBase: string;
  auth: {
    /** OIDC issuer, the Keycloak realm `depot`. */
    authority: string;
    clientId: string;
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

/** Loads `config.json` relative to the base href; fails loudly if it is missing or incomplete. */
export async function loadAppConfig(): Promise<AppConfig> {
  const url = new URL('config.json', document.baseURI).toString();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  }
  const config = (await res.json()) as AppConfig;
  if (!config.apiBase || !config.auth?.authority || !config.auth?.clientId) {
    throw new Error(`${url} must set apiBase, auth.authority and auth.clientId`);
  }
  return config;
}
