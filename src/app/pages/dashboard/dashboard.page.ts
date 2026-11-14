import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCheckbox, IonItem, IonLabel,
  IonList, IonNote, IonProgressBar, IonSpinner, IonText,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { OnboardingStep, UsageReport } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError, formatBytes } from '../../core/ui/format';

/**
 * Signed-in home: the first-login API key (shown once), the getting-started checklist and the
 * plan's storage and download usage.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem,
    IonLabel, IonCheckbox, IonNote, IonText, IonSpinner, IonProgressBar,
  ],
  template: `
    @if (session.firstKey(); as key) {
      <details class="dev">
        <summary>For developers: connect your own software (optional)</summary>
        <p>
          We created an access key so programs can use your storage. You only need it if you write
          code against Depot. It is shown only now; you can always create a new one under Developers.
        </p>
        <code class="secret">{{ key }}</code>
        <ion-button size="small" (click)="copy(key)">{{ copied() ? 'Copied' : 'Copy key' }}</ion-button>
        <ion-button size="small" fill="clear" (click)="session.dismissKey()">Hide</ion-button>
      </details>
    }

    <p>
      Tenant <strong>{{ session.tenant()?.slug }}</strong> · plan {{ session.tenant()?.plan }} ·
      your role {{ session.tenant()?.role?.toLowerCase() }}
    </p>

    <ion-card>
      <ion-card-header><ion-card-title>Usage</ion-card-title></ion-card-header>
      <ion-card-content>
        @if (usageProblem()) {
          <ion-text color="danger"><p role="alert">{{ usageProblem() }}</p></ion-text>
        } @else if (usage(); as u) {
          <div class="meter">
            <span>Storage: {{ bytes(u.storage.storedBytes) }} of {{ bytes(u.storage.limitBytes) }}
              ({{ u.storage.objectCount }} files)</span>
            <ion-progress-bar [value]="storageShare()" [color]="storageShare() > 0.9 ? 'danger' : 'primary'"
              aria-label="Storage used" />
          </div>
          <div class="meter">
            <span>Downloads this month: {{ bytes(u.month.egressBytes) }}
              @if (u.month.egressLimitBytes) { of {{ bytes(u.month.egressLimitBytes) }} }
              · {{ u.month.requests }} requests</span>
            @if (u.month.egressLimitBytes) {
              <ion-progress-bar [value]="egressShare()" [color]="egressShare() > 0.9 ? 'danger' : 'primary'"
                aria-label="Downloads used" />
            }
          </div>
          @if (u.storage.reservedBytes > 0) {
            <ion-note>{{ bytes(u.storage.reservedBytes) }} is held by uploads in progress.</ion-note>
          }
        } @else {
          <ion-spinner name="crescent" aria-label="Loading usage" />
        }
      </ion-card-content>
    </ion-card>

    <h2>Getting started</h2>
    <ion-list>
      @for (step of steps(); track step.id) {
        <ion-item>
          <ion-checkbox slot="start" [checked]="step.done" disabled aria-hidden="true" />
          <ion-label>{{ step.title }}</ion-label>
          @if (step.done) { <ion-note slot="end">Done</ion-note> }
        </ion-item>
      }
    </ion-list>
    <ion-button routerLink="/app/files">Open files</ion-button>
  `,
  styles: [`
    .secret { display: block; word-break: break-all; margin: 0.5rem 0; font-size: 0.95rem; }
    .meter { margin-bottom: 1rem; display: grid; gap: 0.35rem; }
    .dev { border: 1px solid var(--ion-color-light-shade); border-radius: 8px; padding: 0.5rem 0.75rem;
      margin-bottom: 1rem; }
    .dev summary { cursor: pointer; color: var(--ion-color-medium-shade); }
  `],
})
export class DashboardPage implements OnInit {
  private readonly api = inject(DepotApi);
  protected readonly session = inject(SessionService);

  protected readonly steps = signal<OnboardingStep[]>([]);
  protected readonly usage = signal<UsageReport | null>(null);
  protected readonly usageProblem = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly bytes = formatBytes;

  protected readonly storageShare = computed(() => {
    const s = this.usage()?.storage;
    return s && s.limitBytes > 0 ? Math.min(1, (s.storedBytes + s.reservedBytes) / s.limitBytes) : 0;
  });
  protected readonly egressShare = computed(() => {
    const m = this.usage()?.month;
    return m?.egressLimitBytes ? Math.min(1, m.egressBytes / m.egressLimitBytes) : 0;
  });

  ngOnInit(): void {
    this.api.onboarding().subscribe({ next: (s) => this.steps.set(s), error: () => this.steps.set([]) });
    this.api.usage().subscribe({
      next: (u) => this.usage.set(u),
      error: (e: ApiError) => this.usageProblem.set(describeError(e)),
    });
  }

  async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    this.copied.set(true);
  }
}
