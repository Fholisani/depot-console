import { Injectable, signal } from '@angular/core';

/** Cookie the ingress reads to send page loads to the passive Console (nginx canary-by-cookie). */
export const PASSIVE_COOKIE = 'depot_passive';

/** True when the browser is in passive (test) mode. */
export function isPassive(): boolean {
  return document.cookie.split('; ').includes(`${PASSIVE_COOKIE}=always`);
}

/**
 * Writes or clears the passive cookie. nginx sends a request to the passive slot only when the
 * value is exactly "always". Kept in a cookie (not local storage) so page loads carry it too.
 */
export function writePassive(on: boolean): void {
  document.cookie = on
    ? `${PASSIVE_COOKIE}=always; Path=/; SameSite=Lax; Secure`
    : `${PASSIVE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
}

/**
 * Applies `?slot=passive` or `?slot=active` from the address bar before the app starts, then reloads
 * without the parameter so the page itself comes from the chosen slot. Returns true when it reloads.
 */
export function applySlotParameter(): boolean {
  const url = new URL(location.href);
  const slot = url.searchParams.get('slot');
  if (slot !== 'passive' && slot !== 'active') {
    return false;
  }
  writePassive(slot === 'passive');
  url.searchParams.delete('slot');
  location.replace(url.href);
  return true;
}

export type Environment = 'dev' | 'passive' | 'active';

/** Where this page is running: on the developer's machine, the passive (test) slot, or the live one. */
export function currentEnvironment(): Environment {
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    return 'dev';
  }
  return isPassive() ? 'passive' : 'active';
}

/**
 * The address to hand out for a share token. It points back at the environment it was made in:
 * a link made on the passive slot opens on the passive slot (`?slot=passive` switches the visitor's
 * browser there), and a link made while developing opens on this machine only.
 */
export function shareLinkFor(token: string): string {
  const url = new URL(`s/${token}`, document.baseURI);
  if (currentEnvironment() === 'passive') {
    url.searchParams.set('slot', 'passive');
  }
  return url.href;
}

/**
 * Active/Passive tester toggle (Requirement 17.20). In passive mode the page comes from the passive
 * Console (cookie) and API calls carry `X-Slot: Passive`, so the whole session runs on the passive
 * slots of both the Console and the API.
 */
@Injectable({ providedIn: 'root' })
export class SlotService {
  readonly passive = signal(isPassive());

  setPassive(on: boolean): void {
    writePassive(on);
    this.passive.set(on);
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    window.location.assign(base);   // reload so the page itself comes from the chosen slot
  }
}
