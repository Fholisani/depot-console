import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';

describe('ApiError.from', () => {
  it('reads reason, field and request id from the Depot error envelope', () => {
    const e = ApiError.from(new HttpErrorResponse({
      status: 400,
      error: {
        data: null,
        message: 'VALIDATION_ERROR',
        errors: [{ code: 3001, message: 'Bad slug', reason: 'VALIDATION_ERROR', field: 'slug', requestId: 'r-1' }],
      },
    }));
    expect(e.status).toBe(400);
    expect(e.reason).toBe('VALIDATION_ERROR');
    expect(e.field).toBe('slug');
    expect(e.requestId).toBe('r-1');
    expect(e.message).toBe('Bad slug');
  });

  it('treats status 0 as a network failure', () => {
    expect(ApiError.from(new HttpErrorResponse({ status: 0 })).reason).toBe('NETWORK_ERROR');
  });

  it('keeps the request id header when the body is not an envelope', () => {
    const e = ApiError.from(new HttpErrorResponse({
      status: 502, error: 'Bad gateway', headers: new HttpHeaders({ 'X-Request-Id': 'r-2' }),
    }));
    expect(e.reason).toBe('UNKNOWN');
    expect(e.requestId).toBe('r-2');
  });
});
