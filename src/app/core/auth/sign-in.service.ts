import { Injectable, inject, signal } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';

/** How long the page may wait for the sign-in service before it says so. */
export const SIGN_IN_PATIENCE_MS = 12_000;

export type SignInState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  /** The browser is still waiting for the sign-in page. */
  | { kind: 'slow' }
  /** Came back from the sign-in service but the sign-in did not complete. */
  | { kind: 'failed'; reason: string };

/**
 * Starts sign-in and notices when it does not happen. Sign-in sends the browser to Keycloak; when
 * Keycloak (or its database) stalls, the request just stays pending and the page looked like the
 * button did nothing. While that navigation is pending this page is still running, so a timer can
 * tell the user and offer to try again.
 */
@Injectable({ providedIn: 'root' })
export class SignInService {
  private readonly oidc = inject(OidcSecurityService);
  readonly state = signal<SignInState>({ kind: 'idle' });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly leaving = (): void => this.clearTimer();

  start(): void {
    if (this.state().kind === 'starting') {
      return;                                  // one sign-in at a time
    }
    this.state.set({ kind: 'starting' });
    window.addEventListener('pagehide', this.leaving, { once: true });
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state().kind === 'starting') {
        this.state.set({ kind: 'slow' });
      }
    }, SIGN_IN_PATIENCE_MS);
    try {
      this.oidc.authorize();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Stops the pending navigation and starts sign-in again. */
  tryAgain(): void {
    try {
      window.stop();
    } catch {
      // not available: the new navigation replaces the old one anyway
    }
    this.state.set({ kind: 'idle' });
    this.start();
  }

  /** The sign-in callback came back without a session (for example the token exchange failed). */
  fail(reason: string): void {
    this.clearTimer();
    this.state.set({ kind: 'failed', reason });
  }

  dismiss(): void {
    this.clearTimer();
    this.state.set({ kind: 'idle' });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
