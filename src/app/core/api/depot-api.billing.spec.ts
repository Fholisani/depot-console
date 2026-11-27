import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatMoney } from '../ui/format';
import { APP_CONFIG } from '../config/app-config';
import { DepotApi } from './depot-api.service';

const ok = (data: unknown): object => ({ data, errors: [], message: 'OK' });

describe('DepotApi plans and plan requests', () => {
  let api: DepotApi;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { apiBase: '/depot', auth: { authority: 'x', clientId: 'y' } } },
      ],
    });
    api = TestBed.inject(DepotApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reads the overview, asks for a plan and cancels', async () => {
    const o = firstValueFrom(api.billing());
    http.expectOne((r) => r.method === 'GET' && r.url === '/depot/v1/billing').flush(ok({ currentPlan: 'free' }));
    expect(await o).toMatchObject({ currentPlan: 'free' });

    const s = firstValueFrom(api.requestPlan('family'));
    const req = http.expectOne('/depot/v1/billing/plan-requests');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ plan: 'family' });
    req.flush(ok({ next: 'APPROVAL' }));
    expect(await s).toMatchObject({ next: 'APPROVAL' });

    const c = firstValueFrom(api.cancelPlanRequest('r1'), { defaultValue: undefined });
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/depot/v1/billing/plan-requests/r1').flush(null, { status: 204, statusText: 'No Content' });
    await c;
  });

  it('lets the operator list, approve and decline with a note', async () => {
    const l = firstValueFrom(api.operatorPlanRequests());
    http.expectOne('/depot/v1/operator/plan-requests').flush(ok([]));
    expect(await l).toEqual([]);

    const a = firstValueFrom(api.approvePlanRequest('r1', 'paid'));
    const ar = http.expectOne('/depot/v1/operator/plan-requests/r1/approve');
    expect(ar.request.body).toEqual({ note: 'paid' });
    ar.flush(ok({ status: 'APPROVED' }));
    await a;

    const d = firstValueFrom(api.rejectPlanRequest('r1', null));
    const dr = http.expectOne('/depot/v1/operator/plan-requests/r1/reject');
    expect(dr.request.body).toEqual({ note: null });
    dr.flush(ok({ status: 'REJECTED' }));
    await d;
  });
});

describe('formatMoney', () => {
  it('shows rand prices the way customers write them', () => {
    expect(formatMoney(0, 'ZAR')).toBe('Free');
    expect(formatMoney(1500, 'ZAR')).toBe('R15');
    expect(formatMoney(5500, 'ZAR')).toBe('R55');
    expect(formatMoney(1999, 'ZAR')).toMatch(/^R19[.,]99$/);
  });
});
