import { Injectable, signal } from '@angular/core';

/**
 * Active/Passive tester toggle (Requirement 17.20). The passive slot is reached with the
 * `depot_passive=1` cookie (for browser navigations) and the `X-Slot: Passive` header (for API
 * calls); the server only honours them for testers. Kept in a cookie, not local storage.
 */
@Injectable({ providedIn: 'root' })
export class SlotService {
  private static readonly COOKIE = 'depot_passive';

  readonly passive = signal(document.cookie.split('; ').includes(`${SlotService.COOKIE}=1`));

  setPassive(on: boolean): void {
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    document.cookie = on
      ? `${SlotService.COOKIE}=1; Path=/; SameSite=Lax; Secure`
      : `${SlotService.COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
    this.passive.set(on);
    window.location.assign(base);   // reload so the page itself comes from the chosen slot
  }
}
