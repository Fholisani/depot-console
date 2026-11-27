import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError } from '../api/api-error';
import { DepotApi } from '../api/depot-api.service';
import type { FirstLogin } from '../api/models';

/**
 * Holds the result of `GET /v1/tenant`. That call activates the tenant on first login and returns
 * the one-time API key, so exactly one place calls it (here) and everyone else reads the result.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(DepotApi);

  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly current = signal<FirstLogin | null>(null);

  readonly tenant = computed(() => this.current()?.tenant ?? null);
  /** Admins and owners can manage namespaces, keys, rules and webhooks. */
  readonly canManage = computed(() => ['OWNER', 'ADMIN'].includes(this.tenant()?.role ?? ''));
  /** Members and above can upload and edit objects. */
  readonly canWrite = computed(() => ['OWNER', 'ADMIN', 'MEMBER'].includes(this.tenant()?.role ?? ''));
  /** The key from first login. Cleared once the user has seen it. */
  readonly firstKey = computed(() => this.current()?.apiKey ?? null);
  /** Whether the signed-in user runs the platform (`depot-operator`); shows the operator page. */
  readonly operator = signal(false);

  load(): void {
    if (this.loading()) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api.tenant().subscribe({
      next: (t) => {
        this.current.set(t);
        this.loading.set(false);
        this.api.me().subscribe({ next: (me) => this.operator.set(me.operator === true), error: () => this.operator.set(false) });
      },
      error: (e: ApiError) => {
        this.error.set(e);
        this.loading.set(false);
      },
    });
  }

  dismissKey(): void {
    const c = this.current();
    if (c) {
      this.current.set({ ...c, apiKey: null });
    }
  }

  clear(): void {
    this.current.set(null);
    this.error.set(null);
    this.operator.set(false);
  }
}
