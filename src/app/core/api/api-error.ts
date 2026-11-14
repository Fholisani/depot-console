import { HttpErrorResponse } from '@angular/common/http';
import type { DepotError, ErrorEnvelope, ErrorReason } from './models';

/**
 * A failed Depot call, normalised from the error envelope (or a transport failure). Components
 * branch on `reason`, the stable machine-readable name from the contract, never on `message`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: ErrorReason | 'NETWORK_ERROR' | 'UNKNOWN',
    message: string,
    readonly errors: DepotError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** The request field at fault, for validation errors. */
  get field(): string | undefined {
    return this.errors[0]?.field;
  }

  static from(e: unknown): ApiError {
    if (e instanceof ApiError) {
      return e;
    }
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) {
        return new ApiError(0, 'NETWORK_ERROR', 'Depot could not be reached. Check your connection.');
      }
      const body = e.error as Partial<ErrorEnvelope> | null;
      const first = body?.errors?.[0];
      if (first) {
        return new ApiError(e.status, first.reason, first.message, body!.errors!, first.requestId);
      }
      return new ApiError(e.status, 'UNKNOWN', e.message, [], e.headers?.get('X-Request-Id') ?? undefined);
    }
    return new ApiError(0, 'UNKNOWN', String(e));
  }
}
