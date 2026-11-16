import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from './api-error';
import { DepotApi } from './depot-api.service';

const unavailable = { data: null, message: 'SEARCH_UNAVAILABLE',
  errors: [{ code: 3601, message: 'Search is temporarily unavailable', reason: 'SEARCH_UNAVAILABLE' }] };
const results = { data: { items: [{ objectId: 'o1' }], nextCursor: null }, errors: [], message: 'OK' };

describe('DepotApi.search retry', () => {
  let api: DepotApi;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { apiBase: '/depot', auth: { authority: 'x', clientId: 'y' } } },
      ],
    });
    api = TestBed.inject(DepotApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  const answer = (body: object, status = 200): void => {
    const req = http.expectOne((r) => r.url.endsWith('/v1/search'));
    req.flush(body, { status, statusText: status === 200 ? 'OK' : 'Service Unavailable' });
  };

  it('retries quietly while search is unavailable, then returns the results', async () => {
    let got: unknown;
    let failed: unknown;
    api.search({ size: 25 }).subscribe({ next: (r) => (got = r), error: (e) => (failed = e) });

    answer(unavailable, 503);
    await vi.advanceTimersByTimeAsync(2000);
    answer(unavailable, 503);
    await vi.advanceTimersByTimeAsync(5000);
    answer(results);

    expect(failed).toBeUndefined();
    expect(got).toMatchObject({ items: [{ objectId: 'o1' }] });
  });

  it('shows the error once the retries are used up', async () => {
    let failed: unknown;
    api.search({ size: 25 }).subscribe({ error: (e) => (failed = e) });
    answer(unavailable, 503);
    for (const wait of [2000, 5000, 10000]) {
      await vi.advanceTimersByTimeAsync(wait);
      answer(unavailable, 503);
    }
    expect(failed).toBeInstanceOf(ApiError);
    expect((failed as ApiError).reason).toBe('SEARCH_UNAVAILABLE');
  });

  it('does not retry other errors', async () => {
    let failed: unknown;
    api.search({ size: 25 }).subscribe({ error: (e) => (failed = e) });
    answer({ data: null, message: 'x', errors: [{ code: 3001, message: 'Bad', reason: 'VALIDATION_ERROR' }] }, 400);
    await vi.advanceTimersByTimeAsync(20000);
    expect((failed as ApiError).reason).toBe('VALIDATION_ERROR');
  });
});
