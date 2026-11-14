import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { switchMap, take } from 'rxjs';
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
  return inject(OidcSecurityService).getAccessToken().pipe(
    take(1),
    switchMap((token) => {
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return next(req.clone({ setHeaders: headers }));
    }),
  );
};
