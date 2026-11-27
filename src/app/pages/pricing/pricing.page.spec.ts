import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotApi } from '../../core/api/depot-api.service';
import type { PlanOffer } from '../../core/api/models';
import { PricingPage } from './pricing.page';

const GB = 1024 ** 3;
const offer = (name: string, displayName: string, gb: number, egressGb: number, cents: number): PlanOffer => ({
  name, displayName, description: `About ${displayName}`, maxStorageBytes: gb * GB,
  maxEgressBytesPerMonth: egressGb * GB, priceCents: cents, currency: 'ZAR', period: 'month',
});
const PLANS = [offer('free', 'Free', 10, 50, 0), offer('family', 'Family', 50, 200, 1500), offer('plus', 'Plus', 200, 500, 5500)];

async function render(api: Partial<DepotApi>, copy: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => copy === null
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(copy) })));
  TestBed.configureTestingModule({
    imports: [PricingPage], providers: [provideRouter([]), { provide: DepotApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(PricingPage);
  fixture.detectChanges();
  await fixture.componentInstance.ngOnInit();
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('PricingPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the prices and limits the API enforces, with the wording from pricing.json', async () => {
    const text = await render({ plans: () => of(PLANS) }, {
      plans: [{ id: 'family', summary: 'For a family', features: ['Everything in Free'], cta: 'Choose Family' }],
      note: 'We get in touch about payment.',
    });
    expect(text).toContain('R15');
    expect(text).toContain('R55');
    expect(text).toContain('50 GB storage');
    expect(text).toContain('200 GB downloads a month');
    expect(text).toContain('For a family');
    expect(text).toContain('Everything in Free');
    expect(text).toContain('We get in touch about payment.');
    expect(text).toContain('About Plus');          // no wording for plus: the plan's own description
    expect(text).toContain('Choose Plus');
  });

  it('still shows the plans when pricing.json cannot be read', async () => {
    const text = await render({ plans: () => of(PLANS) }, null);
    expect(text).toContain('Family');
    expect(text).toContain('Start free');
  });

  it('says so when the plans cannot be loaded', async () => {
    const text = await render({ plans: () => throwError(() => new Error('down')) }, { plans: [] });
    expect(text).toContain('Pricing could not be loaded');
  });
});
