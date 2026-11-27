import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { DepotApi } from '../../core/api/depot-api.service';
import type { PlanOffer } from '../../core/api/models';
import { formatMoney, formatPlanSize } from '../../core/ui/format';

/** Wording for one plan from `pricing.json` (matched by plan name); prices and limits come from the API. */
interface PlanCopy {
  id: string;
  summary?: string;
  /** Extra lines after the storage and download limits. */
  features?: string[];
  cta?: string;
  /** Where the button goes; sign-up when missing. */
  link?: string;
}

interface PricingCopy {
  plans: PlanCopy[];
  note?: string;
}

/** A plan as the page shows it. */
interface Card {
  name: string;
  title: string;
  price: string;
  paid: boolean;
  summary: string | null;
  features: string[];
  cta: string;
  link: string;
}

/**
 * Plans with the prices and limits the API enforces (`GET /v1/public/plans`), so they can never disagree.
 * The wording around them (summary, extra features, button) comes from `pricing.json` next to `index.html`,
 * so it changes without a new build.
 */
@Component({
  selector: 'app-pricing',
  imports: [IonButton, IonSpinner, RouterLink],
  template: `
    <section class="container head">
      <h1>Simple pricing</h1>
      <p class="muted">Start free. Pay only when you need more.</p>
    </section>
    <section class="container">
      @if (cards(); as list) {
        <div class="plans">
          @for (c of list; track c.name) {
            <div class="card plan" [class.featured]="!c.paid">
              <h2>{{ c.title }}</h2>
              <p class="price">
                <span class="amount">{{ c.price }}</span>
                @if (c.paid) { <span class="muted">/ month</span> }
              </p>
              @if (c.summary) { <p class="muted">{{ c.summary }}</p> }
              <ul>
                @for (f of c.features; track f) { <li>{{ f }}</li> }
              </ul>
              <ion-button expand="block" [routerLink]="c.link">{{ c.cta }}</ion-button>
            </div>
          }
        </div>
        @if (note()) { <p class="muted note">{{ note() }}</p> }
      } @else if (failed()) {
        <p class="muted">Pricing could not be loaded. The free plan includes 10 GB of storage.</p>
      } @else {
        <ion-spinner name="crescent" aria-label="Loading pricing" />
      }
    </section>
  `,
  styles: [`
    .head { text-align: center; padding: 4rem 1.25rem 2rem; }
    .head h1 { font-size: 2.4rem; margin: 0 0 0.5rem; }
    .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 20rem)); gap: 1.5rem;
      justify-content: center; }
    .plan h2 { margin: 0; }
    .plan.featured { border-color: var(--ion-color-primary); box-shadow: 0 0 0 1px var(--ion-color-primary), var(--depot-shadow); }
    .price { margin: 0.75rem 0 0.25rem; }
    .amount { font-size: 2rem; font-weight: 700; margin-right: 0.25rem; }
    ul { padding-left: 1.1rem; line-height: 1.9; margin: 1rem 0 1.5rem; }
    .note { text-align: center; margin-top: 2rem; }
  `],
})
export class PricingPage implements OnInit {
  private readonly api = inject(DepotApi);
  protected readonly cards = signal<Card[] | null>(null);
  protected readonly note = signal<string | null>(null);
  protected readonly failed = signal(false);

  async ngOnInit(): Promise<void> {
    const copy = this.loadCopy();
    try {
      const plans = await firstValueFrom(this.api.plans());
      const words = await copy;
      this.note.set(words.note ?? null);
      this.cards.set(plans.map((p) => card(p, words.plans.find((c) => c.id === p.name))));
    } catch {
      this.failed.set(true);
    }
  }

  /** The wording; none (plain cards) when the file cannot be read. */
  private async loadCopy(): Promise<PricingCopy> {
    try {
      const res = await fetch(new URL('pricing.json', document.baseURI), { cache: 'no-cache' });
      return res.ok ? ((await res.json()) as PricingCopy) : { plans: [] };
    } catch {
      return { plans: [] };
    }
  }
}

function card(p: PlanOffer, copy: PlanCopy | undefined): Card {
  const limits = [`${formatPlanSize(p.maxStorageBytes)} storage`];
  if (p.maxEgressBytesPerMonth > 0) {
    limits.push(`${formatPlanSize(p.maxEgressBytesPerMonth)} downloads a month`);
  }
  const paid = p.priceCents > 0;
  return {
    name: p.name,
    title: p.displayName,
    price: formatMoney(p.priceCents, p.currency),
    paid,
    summary: copy?.summary ?? p.description ?? null,
    features: [...limits, ...(copy?.features ?? [])],
    cta: copy?.cta ?? (paid ? `Choose ${p.displayName}` : 'Start free'),
    link: copy?.link ?? (paid ? '/app/plan' : '/signup'),
  };
}
