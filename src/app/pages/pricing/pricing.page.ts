import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';

interface PricingPlan {
  id: string;
  name: string;
  /** Monthly price; null when it is not set yet. */
  price: number | null;
  period: string;
  summary: string;
  features: string[];
  cta: string;
  available: boolean;
}

interface Pricing {
  currency: string;
  plans: PricingPlan[];
  note?: string;
}

/**
 * Plans, read from `pricing.json` next to `index.html`, so prices and limits change without a
 * new build. Keep the limits there equal to the operator's plan quotas.
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
      @if (pricing(); as p) {
        <div class="plans">
          @for (plan of p.plans; track plan.id) {
            <div class="card plan" [class.featured]="plan.available && plan.price === 0">
              <h2>{{ plan.name }}</h2>
              <p class="price">
                @if (plan.price === null) {
                  <span class="amount">Soon</span>
                } @else {
                  <span class="amount">{{ money(plan.price, p.currency) }}</span>
                  @if (plan.price > 0) { <span class="muted">/ {{ plan.period }}</span> }
                }
              </p>
              <p class="muted">{{ plan.summary }}</p>
              <ul>
                @for (f of plan.features; track f) { <li>{{ f }}</li> }
              </ul>
              <ion-button expand="block" [disabled]="!plan.available" routerLink="/signup"
                [fill]="plan.available ? 'solid' : 'outline'">{{ plan.cta }}</ion-button>
            </div>
          }
        </div>
        @if (p.note) { <p class="muted note">{{ p.note }}</p> }
      } @else if (failed()) {
        <p class="muted">Pricing could not be loaded. The free plan includes 5 GB of storage.</p>
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
  protected readonly pricing = signal<Pricing | null>(null);
  protected readonly failed = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const res = await fetch(new URL('pricing.json', document.baseURI), { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      this.pricing.set((await res.json()) as Pricing);
    } catch {
      this.failed.set(true);
    }
  }

  protected money(amount: number, currency: string): string {
    return amount === 0
      ? 'Free'
      : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  }
}
