import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../config/app-config';
import { depotInterceptor } from './depot.interceptor';

/** Stand-in for the OIDC library: a current token with an expiry, and a renew that hands out a new one. */
class FakeOidc {
  token = 'old';
  exp = Date.now() / 1000 + 600;
  renewals = 0;
  renewWorks = true;
  authorizeCalls = 0;
  getAccessToken() {
    return of(this.token);
  }
  getPayloadFromAccessToken() {
    return of({ exp: this.exp });
  }
  forceRefreshSession() {
    this.renewals++;
    if (!this.renewWorks) {
      return throwError(() => new Error('refresh token expired'));
    }
    this.token = `new${this.renewals}`;
    this.exp = Date.now() / 1000 + 600;
    return of({ isAuthenticated: true, accessToken: this.token });
  }
  authorize() {
    this.authorizeCalls++;
  }
}

describe('depotInterceptor tokens', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let oidc: FakeOidc;

  beforeEach(() => {
    oidc = new FakeOidc();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([depotInterceptor])),
        provideHttpClientTesting(),
        { provide: OidcSecurityService, useValue: oidc },
        { provide: APP_CONFIG, useValue: { apiBase: '/depot', auth: { authority: 'x', clientId: 'y' } } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  const call = (): Promise<unknown> => firstValueFrom(http.get('/depot/v1/search'));
  const auth = (): string | null => backend.expectOne('/depot/v1/search').request.headers.get('Authorization');
  const next = () => backend.expectOne('/depot/v1/search');

  it('sends the current token while it has time left', async () => {
    const p = call();
    await Promise.resolve();
    const req = next();
    expect(req.request.headers.get('Authorization')).toBe('Bearer old');
    req.flush({ data: {} });
    await p;
    expect(oidc.renewals).toBe(0);
  });

  it('renews first when the token expired while the phone was asleep', async () => {
    oidc.exp = Date.now() / 1000 - 60;
    const p = call();
    await Promise.resolve();
    const req = next();
    expect(req.request.headers.get('Authorization')).toBe('Bearer new1');
    req.flush({ data: {} });
    await p;
    expect(oidc.renewals).toBe(1);
  });

  it('on a 401 renews once and sends the request again', async () => {
    const p = call();
    await Promise.resolve();
    next().flush({}, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    const retry = next();
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new1');
    retry.flush({ data: { ok: true } });
    await expect(p).resolves.toEqual({ data: { ok: true } });
    expect(oidc.authorizeCalls).toBe(0);
  });

  it('goes to sign-in when the session can no longer be renewed', async () => {
    oidc.renewWorks = false;
    const p = call();
    p.catch(() => undefined);
    await Promise.resolve();
    next().flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(p).rejects.toMatchObject({ status: 401 });
    expect(oidc.authorizeCalls).toBe(1);
  });

  it('shares one renewal between requests that all need it', async () => {
    oidc.exp = Date.now() / 1000 - 60;
    const a = call();
    const b = call();
    await Promise.resolve();
    backend.match('/depot/v1/search').forEach((r) => {
      expect(r.request.headers.get('Authorization')).toBe('Bearer new1');
      r.flush({ data: {} });
    });
    await Promise.all([a, b]);
    expect(oidc.renewals).toBe(1);
  });
});
