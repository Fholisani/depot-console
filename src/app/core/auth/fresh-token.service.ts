import { Injectable, inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, take } from 'rxjs';
import { SignInService } from './sign-in.service';

/** Renew when the access token has less than this left, so it cannot expire on the way. */
export const RENEW_MARGIN_SECONDS = 30;

/**
 * Hands out an access token that is not about to expire. The library renews on a timer, but a phone
 * freezes timers while the screen is off or Safari is in the background; coming back, requests went
 * out with an expired token and the page showed "Authentication is required". This checks the expiry
 * before each request, renews when needed (one renewal shared by all waiting requests), and renews as
 * soon as the page is visible again.
 */
@Injectable({ providedIn: 'root' })
export class FreshTokenService {
  private readonly oidc = inject(OidcSecurityService);
  private readonly signIn = inject(SignInService);
  private renewing: Observable<string | null> | null = null;
  private signingIn = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.token().subscribe();
        }
      });
    }
  }

  /** A token with more than the margin left, renewing first if needed; null when signed out. */
  token(): Observable<string | null> {
    return this.oidc.getAccessToken().pipe(
      take(1),
      switchMap((token) => {
        if (!token) {
          return of(null);
        }
        return this.secondsLeft().pipe(
          switchMap((left) => (left > RENEW_MARGIN_SECONDS ? of(token) : this.renew())),
        );
      }),
    );
  }

  /** Renews the session now (one renewal at a time); null when it could not be renewed. */
  renew(): Observable<string | null> {
    if (!this.renewing) {
      this.renewing = this.oidc.forceRefreshSession().pipe(
        map((r) => (r?.isAuthenticated && r.accessToken ? r.accessToken : null)),
        catchError(() => of(null)),
        finalize(() => (this.renewing = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.renewing;
  }

  /** The sign-in session ended: go to the sign-in page once instead of showing errors. */
  signInAgain(): void {
    if (this.signingIn) {
      return;
    }
    this.signingIn = true;
    this.signIn.start();
  }

  private secondsLeft(): Observable<number> {
    return this.oidc.getPayloadFromAccessToken().pipe(
      take(1),
      map((p: { exp?: number } | null) => (p?.exp ? p.exp - Date.now() / 1000 : Number.POSITIVE_INFINITY)),
      catchError(() => of(0)),
    );
  }
}
