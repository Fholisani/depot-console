import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { DepotApi } from '../../core/api/depot-api.service';
import { SessionService } from '../../core/tenant/session.service';
import { DashboardPage } from './dashboard.page';

const report = (stored: number) => ({
  plan: 'free', storage: { storedBytes: stored, reservedBytes: 0, objectCount: 3, limitBytes: 10 * 1024 ** 3 },
  month: { egressBytes: 0, requests: 0, egressLimitBytes: null }, daily: [],
});

describe('DashboardPage', () => {
  it('shows the new space used when the tab is shown again after an upload', () => {
    let stored = 100;
    let usageCalls = 0;
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
        { provide: DepotApi, useValue: {
          usage: () => { usageCalls++; return of(report(stored)); },
          files: () => of({ items: [], nextCursor: null }),
        } },
        { provide: SessionService, useValue: new Proxy({}, { get: () => signal(true) }) },
      ],
    });
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { ionViewWillEnter(): void; used(): number };
    expect(page.used()).toBe(100);

    stored = 350;                       // the user uploaded, then comes back to the dashboard tab
    page.ionViewWillEnter();
    expect(usageCalls).toBe(2);
    expect(page.used()).toBe(350);
  });
});
