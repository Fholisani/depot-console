import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { BillingOverview, PlanOffer, PlanRequestStarted } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { PlanPage } from './plan.page';

const GB = 1024 ** 3;
const offer = (name: string, gb: number, cents: number): PlanOffer => ({
  name, displayName: name[0].toUpperCase() + name.slice(1), description: null, maxStorageBytes: gb * GB,
  maxEgressBytesPerMonth: 0, priceCents: cents, currency: 'ZAR', period: 'month',
});
const PLANS = [offer('free', 10, 0), offer('family', 50, 1500), offer('plus', 200, 5500)];
const overview = (extra: Partial<BillingOverview> = {}): BillingOverview => ({
  currentPlan: 'free', plans: PLANS, storedBytes: 8 * GB, reservedBytes: 0, maxStorageBytes: 10 * GB, pending: null,
  lastDecision: null, ...extra,
});

function setup(api: Partial<DepotApi>, canManage = true, confirmed = true) {
  TestBed.configureTestingModule({
    imports: [PlanPage],
    providers: [
      { provide: DepotApi, useValue: api },
      { provide: SessionService, useValue: { canManage: signal(canManage) } },
      { provide: ConfirmService, useValue: { ask: () => Promise.resolve(confirmed) } },
    ],
  });
  const fixture = TestBed.createComponent(PlanPage);
  fixture.detectChanges();
  const text = () => { fixture.detectChanges(); return (fixture.nativeElement as HTMLElement).textContent ?? ''; };
  return { fixture, page: fixture.componentInstance, text };
}

describe('PlanPage', () => {
  it('shows the plan, storage and the paid plans with their prices', () => {
    const { text } = setup({ billing: () => of(overview()) });
    expect(text()).toContain('Free');
    expect(text()).toContain('8.00 GB of 10.0 GB used');
    expect(text()).toContain('R15');
    expect(text()).toContain('R55');
    expect(text()).toContain('Choose Family');
    expect(text()).toContain('Choose Plus');
    expect(text()).toContain('Your plan');
  });

  it('sends a request for the chosen plan and then shows it as waiting', async () => {
    let state = overview();
    const requestPlan = vi.fn((plan: string) => {
      const request = { id: 'r1', fromPlan: 'free', toPlan: plan, toPlanName: 'Family', status: 'PENDING' as const,
        amountCents: 1500, currency: 'ZAR', requestedAt: '2026-05-01T10:00:00Z', decidedAt: null, note: null };
      state = overview({ pending: request });
      return of<PlanRequestStarted>({ request, next: 'APPROVAL' });
    });
    const { page, text } = setup({ billing: () => of(state), requestPlan });
    await page.choose(PLANS[1]);
    expect(requestPlan).toHaveBeenCalledWith('family');
    expect(text()).toContain('Request sent');
    expect(text()).toContain('You asked for Family');
    expect(text()).toContain('Cancel request');
  });

  it('does nothing when the customer says no in the dialog', async () => {
    const requestPlan = vi.fn();
    const { page } = setup({ billing: () => of(overview()), requestPlan }, true, false);
    await page.choose(PLANS[1]);
    expect(requestPlan).not.toHaveBeenCalled();
  });

  it('shows a declined request with the operator\'s note, and a plan the account moved to', () => {
    const decided = { id: 'r2', fromPlan: 'free', toPlan: 'plus', toPlanName: 'Plus', amountCents: 5500,
      currency: 'ZAR', requestedAt: '2026-05-01T10:00:00Z', decidedAt: '2026-05-02T10:00:00Z' };
    const declined = setup({ billing: () => of(overview({ lastDecision: { ...decided, status: 'REJECTED',
      note: 'Not enough disk yet' } })) });
    expect(declined.text()).toContain('Your request for Plus was declined');
    expect(declined.text()).toContain('Not enough disk yet');
    TestBed.resetTestingModule();
    const approved = setup({ billing: () => of(overview({ currentPlan: 'plus', lastDecision: { ...decided,
      status: 'APPROVED', note: null } })) });
    expect(approved.text()).toContain('You moved to Plus');
    expect(approved.text()).not.toContain('declined');
  });

  it('counts files still uploading when deciding what fits', () => {
    const { text } = setup({ billing: () => of(overview({ currentPlan: 'family', storedBytes: 6 * GB,
      reservedBytes: 5 * GB, maxStorageBytes: 50 * GB })) });
    expect(text()).toContain('11.0 GB of 50.0 GB used');
    expect(text()).toContain('Your files take more than this plan holds');
    expect(text()).not.toContain('Choose Free');
  });

  it('shows plan sizes without needless decimals', () => {
    const { text } = setup({ billing: () => of(overview()) });
    expect(text()).toContain('50 GB storage');
    expect(text()).toContain('200 GB storage');
  });

  it('cancels a waiting request', async () => {
    const request = { id: 'r9', fromPlan: 'free', toPlan: 'family', toPlanName: 'Family', status: 'PENDING' as const,
      amountCents: 1500, currency: 'ZAR', requestedAt: '2026-05-01T10:00:00Z', decidedAt: null, note: null };
    let state = overview({ pending: request });
    const cancelPlanRequest = vi.fn(() => { state = overview(); return of(undefined); });
    const { page, text } = setup({ billing: () => of(state), cancelPlanRequest });
    expect(text()).toContain('Request sent');
    await page.cancel('r9');
    expect(cancelPlanRequest).toHaveBeenCalledWith('r9');
    expect(text()).not.toContain('Request sent');
  });

  it('only lets owners and admins choose, and blocks plans the files do not fit', () => {
    const member = setup({ billing: () => of(overview({ storedBytes: 60 * GB, maxStorageBytes: 200 * GB, currentPlan: 'plus' })) }, false);
    expect(member.text()).toContain('Ask the account owner');
    expect(member.text()).not.toContain('Choose');
    TestBed.resetTestingModule();
    const owner = setup({ billing: () => of(overview({ storedBytes: 60 * GB, maxStorageBytes: 200 * GB, currentPlan: 'plus' })) });
    expect(owner.text()).toContain('Your files take more than this plan holds');
    expect(owner.text()).not.toContain('Choose Family');
  });

  it('shows why a request failed', async () => {
    const { page, text } = setup({ billing: () => of(overview()),
      requestPlan: () => throwError(() => new ApiError(400, 'VALIDATION_ERROR', 'You already asked for a plan change')) });
    await page.choose(PLANS[1]);
    expect(text()).toContain('You already asked for a plan change');
  });
});
