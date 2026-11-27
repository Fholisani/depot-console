import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { DepotApi } from '../../core/api/depot-api.service';
import { operatorGuard } from './operator.guard';

async function run(me: () => Observable<unknown>): Promise<boolean | UrlTree> {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DepotApi, useValue: { me } }] });
  const result = TestBed.runInInjectionContext(() => operatorGuard({} as never, {} as never));
  return firstValueFrom(result as Observable<boolean | UrlTree>);
}

describe('operatorGuard', () => {
  it('lets the operator in', async () => {
    expect(await run(() => of({ tenantId: 't', tenantSlug: 's', operator: true }))).toBe(true);
  });

  it('sends everyone else to the dashboard', async () => {
    const r = await run(() => of({ tenantId: 't', tenantSlug: 's', operator: false }));
    expect(TestBed.inject(Router).serializeUrl(r as UrlTree)).toBe('/app/dashboard');
    TestBed.resetTestingModule();
    const failed = await run(() => throwError(() => new Error('401')));
    expect(TestBed.inject(Router).serializeUrl(failed as UrlTree)).toBe('/app/dashboard');
  });
});
