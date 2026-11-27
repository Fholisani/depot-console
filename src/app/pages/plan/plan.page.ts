import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { IonButton, IonNote, IonProgressBar, IonSpinner, IonText } from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { BillingOverview, PlanOffer } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { describeError, formatBytes, formatMoney, formatPlanSize } from '../../core/ui/format';

/**
 * "Need more space?": the account's plan and the plans it can move to. Choosing a paid plan sends a request
 * that waits for approval (the operator arranges payment); a free plan applies at once. The last decision
 * on a request (approved or declined, with the operator's note) shows for 30 days.
 */
@Component({
  selector: 'app-plan',
  imports: [DatePipe, IonButton, IonNote, IonProgressBar, IonSpinner, IonText],
  template: `
    <h1>Your plan</h1>
    @if (problem()) {
      <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
    }
    @if (overview(); as o) {
      <section class="card">
        <p class="big">
          <strong>{{ currentName() }}</strong> ·
          {{ bytes(used()) }} of {{ bytes(o.maxStorageBytes) }} used
        </p>
        <ion-progress-bar [value]="share()" [color]="share() > 0.9 ? 'danger' : 'primary'"
          aria-label="Space used" />
      </section>

      @if (o.pending; as r) {
        <section class="card pending" role="status">
          <h2>Request sent</h2>
          <p>
            You asked for <strong>{{ r.toPlanName }}</strong>
            ({{ money(r.amountCents, r.currency) }} a month) on {{ r.requestedAt | date: 'mediumDate' }}.
            We will be in touch about payment, and switch your account over once it is approved.
          </p>
          @if (session.canManage()) {
            <ion-button fill="outline" color="medium" [disabled]="busy()" (click)="cancel(r.id)">
              Cancel request
            </ion-button>
          }
        </section>
      }

      @if (!o.pending && o.lastDecision; as d) {
        <section class="card decision" [class.declined]="d.status === 'REJECTED'" role="status">
          @if (d.status === 'REJECTED') {
            <p>Your request for <strong>{{ d.toPlanName }}</strong> was declined
              on {{ d.decidedAt | date: 'mediumDate' }}.</p>
          } @else {
            <p>You moved to <strong>{{ d.toPlanName }}</strong> on {{ d.decidedAt | date: 'mediumDate' }}.</p>
          }
          @if (d.note) { <p class="muted">“{{ d.note }}”</p> }
        </section>
      }

      @if (done()) {
        <ion-text color="success"><p role="status">{{ done() }}</p></ion-text>
      }

      <div class="plans">
        @for (p of o.plans; track p.name) {
          <div class="card plan" [class.current]="p.name === o.currentPlan">
            <h2>{{ p.displayName }}</h2>
            <p class="price">
              <span class="amount">{{ money(p.priceCents, p.currency) }}</span>
              @if (p.priceCents > 0) { <span class="muted">/ {{ p.period }}</span> }
            </p>
            <ul>
              <li>{{ size(p.maxStorageBytes) }} storage</li>
              @if (p.maxEgressBytesPerMonth > 0) {
                <li>{{ size(p.maxEgressBytesPerMonth) }} downloads a month</li>
              }
            </ul>
            @if (p.description) { <p class="muted">{{ p.description }}</p> }
            @if (p.name === o.currentPlan) {
              <ion-note>Your plan</ion-note>
            } @else if (!session.canManage()) {
              <ion-note>Ask the account owner to change plan.</ion-note>
            } @else if (used() > p.maxStorageBytes) {
              <ion-note>Your files take more than this plan holds.</ion-note>
            } @else {
              <ion-button expand="block" [disabled]="busy() || !!o.pending" (click)="choose(p)">
                Choose {{ p.displayName }}
              </ion-button>
            }
          </div>
        }
      </div>
    } @else if (!problem()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    }
  `,
  styles: [`
    h1 { margin: 0.5rem 0 1rem; }
    .card { margin-bottom: 1.25rem; }
    .card h2 { font-size: 1.1rem; margin: 0 0 0.5rem; }
    .big { font-size: 1.15rem; margin: 0 0 0.6rem; }
    .pending { border-color: var(--ion-color-warning); }
    .decision p { margin: 0 0 0.35rem; }
    .decision.declined { border-color: var(--ion-color-danger); }
    .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1.25rem; }
    .plan.current { border-color: var(--ion-color-primary); box-shadow: 0 0 0 1px var(--ion-color-primary); }
    .price { margin: 0.25rem 0; }
    .amount { font-size: 1.8rem; font-weight: 700; margin-right: 0.25rem; }
    ul { padding-left: 1.1rem; line-height: 1.8; margin: 0.75rem 0; }
  `],
})
export class PlanPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly confirm = inject(ConfirmService);
  protected readonly session = inject(SessionService);
  protected readonly overview = signal<BillingOverview | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly bytes = formatBytes;
  protected readonly money = formatMoney;
  protected readonly size = formatPlanSize;

  protected readonly currentName = computed(() => {
    const o = this.overview();
    return o?.plans.find((p) => p.name === o.currentPlan)?.displayName ?? o?.currentPlan ?? '';
  });
  /** Stored plus being uploaded: what has to fit a plan. */
  protected readonly used = computed(() => {
    const o = this.overview();
    return o ? o.storedBytes + o.reservedBytes : 0;
  });
  protected readonly share = computed(() => {
    const o = this.overview();
    return o && o.maxStorageBytes > 0 ? Math.min(1, this.used() / o.maxStorageBytes) : 0;
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.billing().subscribe({
      next: (o) => this.overview.set(o),
      error: (e: ApiError) => this.problem.set(describeError(e)),
    });
  }

  async choose(plan: PlanOffer): Promise<void> {
    const paid = plan.priceCents > 0;
    const ok = await this.confirm.ask({
      header: `Move to ${plan.displayName}?`,
      message: paid
        ? `${formatPlanSize(plan.maxStorageBytes)} for ${formatMoney(plan.priceCents, plan.currency)} a month. `
          + 'We will be in touch about payment, and switch you over once it is approved.'
        : `${formatPlanSize(plan.maxStorageBytes)} of storage, free. This applies straight away.`,
      confirmText: paid ? 'Send request' : `Move to ${plan.displayName}`,
    });
    if (!ok) {
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    this.done.set(null);
    this.api.requestPlan(plan.name).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.done.set(s.next === 'DONE'
          ? `You are now on ${plan.displayName}.`
          : `Request sent. We will be in touch about ${plan.displayName}.`);
        this.load();
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e));
        this.load();
      },
    });
  }

  async cancel(id: string): Promise<void> {
    const ok = await this.confirm.ask({
      header: 'Cancel your request?', message: 'Your plan stays as it is.', confirmText: 'Cancel request',
      cancelText: 'Keep it', destructive: true,
    });
    if (!ok) {
      return;
    }
    this.busy.set(true);
    this.done.set(null);
    this.api.cancelPlanRequest(id).subscribe({
      next: () => {
        this.busy.set(false);
        this.load();
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e));
        this.load();
      },
    });
  }
}
