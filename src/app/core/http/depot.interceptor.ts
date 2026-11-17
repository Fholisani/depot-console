import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { FreshTokenService } from '../auth/fresh-token.service';
import { APP_CONFIG } from '../config/app-config';
import { SlotService } from '../slot/slot.service';
import { TenantService } from '../tenant/tenant.service';

/** Endpoints that need no credentials (contract: `security: []`). */
const PUBLIC = [/^\/v1\/signup(\/|$)/, /^\/v1\/public\//, /^\/actuator\/health/];

/**
 * For requests to the Depot API only: adds the user's access token, the selected tenant
 * (`X-Depot-Tenant`) and, for testers, `X-Slot: Passive`. Tokens never go to other origins.
 */
export const depotInterceptor: HttpInterceptorFn = (req, next) => {
  const base = inject(APP_CONFIG).apiBase.replace(/\/$/, '');
  if (!req.url.startsWith(base + '/')) {
    return next(req);
  }
  const path = req.url.substring(base.length);
  const headers: Record<string, string> = {};
  if (inject(SlotService).passive()) {
    headers['X-Slot'] = 'Passive';
  }
  const tenant = inject(TenantService).slug();
  if (tenant) {
    headers['X-Depot-Tenant'] = tenant;
  }
  if (PUBLIC.some((p) => p.test(path))) {
    return next(req.clone({ setHeaders: headers }));
  }
  const tokens = inject(FreshTokenService);
  const send = (token: string | null) => {
    const h = { ...headers };
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
    return next(req.clone({ setHeaders: h }));
  };
  return tokens.token().pipe(
    switchMap((token) => send(token).pipe(
      catchError((e: unknown) => {
        if (!(e instanceof HttpErrorResponse) || e.status !== 401) {
          return throwError(() => e);
        }
        // The token was refused (for example it expired while the phone was asleep): renew once and
        // send again. If the session cannot be renewed, sign in again rather than show the error.
        return tokens.renew().pipe(switchMap((fresh) => {
          if (!fresh) {
            tokens.signInAgain();
            return throwError(() => e);
          }
          return send(fresh).pipe(catchError((again: unknown) => {
            if (again instanceof HttpErrorResponse && again.status === 401) {
              tokens.signInAgain();
            }
            return throwError(() => again);
          }));
        }));
      }),
    )),
  );
};
