import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DepotApi } from '../../core/api/depot-api.service';
import type { OperatorPlanRequest } from '../../core/api/models';
import { OperatorPage } from './operator.page';

const waiting = (): OperatorPlanRequest => ({
  tenantId: 't1', tenantName: 'Mashegana', tenantSlug: 'mashegana', storedBytes: 9 * 1024 ** 3,
  contactEmail: 'owner@family.test',
  request: { id: 'r1', fromPlan: 'free', toPlan: 'family', toPlanName: 'Family', status: 'PENDING',
    amountCents: 1500, currency: 'ZAR', requestedAt: '2026-05-01T10:00:00Z', decidedAt: null, note: null },
});

function setup(api: Partial<DepotApi>) {
  TestBed.configureTestingModule({ imports: [OperatorPage], providers: [{ provide: DepotApi, useValue: api }] });
  const fixture = TestBed.createComponent(OperatorPage);
  fixture.detectChanges();
  const page = fixture.componentInstance as unknown as OperatorPage & {
    askNote(r: OperatorPlanRequest, approve: boolean): Promise<string | null | undefined>;
  };
  const text = () => { fixture.detectChanges(); return (fixture.nativeElement as HTMLElement).textContent ?? ''; };
  return { page, text };
}

describe('OperatorPage', () => {
  it('lists waiting requests with who, what, the price and who to contact', () => {
    const { text } = setup({ operatorPlanRequests: () => of([waiting()]) });
    expect(text()).toContain('Contact owner@family.test');
    expect(document.querySelector('a[href="mailto:owner@family.test"]')).not.toBeNull();
    expect(text()).toContain('Mashegana');
    expect(text()).toContain('Family');
    expect(text()).toContain('R15');
    expect(text()).toContain('Approve');
    expect(text()).toContain('Decline');
  });

  it('approves with the note and reloads the list', async () => {
    let list = [waiting()];
    const approvePlanRequest = vi.fn(() => { list = []; return of(waiting().request); });
    const { page, text } = setup({ operatorPlanRequests: () => of(list), approvePlanRequest });
    vi.spyOn(page, 'askNote').mockResolvedValue('paid by EFT');
    await page.decide(waiting(), true);
    expect(approvePlanRequest).toHaveBeenCalledWith('r1', 'paid by EFT');
    expect(text()).toContain('Nothing waiting');
  });

  it('declines, and does nothing when the dialog is cancelled', async () => {
    const rejectPlanRequest = vi.fn(() => of(waiting().request));
    const { page } = setup({ operatorPlanRequests: () => of([waiting()]), rejectPlanRequest });
    const ask = vi.spyOn(page, 'askNote').mockResolvedValue(undefined);
    await page.decide(waiting(), false);
    expect(rejectPlanRequest).not.toHaveBeenCalled();
    ask.mockResolvedValue(null);
    await page.decide(waiting(), false);
    expect(rejectPlanRequest).toHaveBeenCalledWith('r1', null);
  });
});
