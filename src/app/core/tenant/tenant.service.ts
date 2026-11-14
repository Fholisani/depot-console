import { Injectable, signal } from '@angular/core';

/**
 * The tenant the user is acting in. Only needed when a user belongs to several tenants: the API
 * then answers `TENANT_SELECTION_REQUIRED` until `X-Depot-Tenant` names one.
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private static readonly KEY = 'depot.tenant';

  readonly slug = signal<string | null>(sessionStorage.getItem(TenantService.KEY));

  select(slug: string | null): void {
    if (slug) {
      sessionStorage.setItem(TenantService.KEY, slug);
    } else {
      sessionStorage.removeItem(TenantService.KEY);
    }
    this.slug.set(slug);
  }
}
