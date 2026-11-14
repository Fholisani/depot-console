import { Component, inject, OnInit, signal } from '@angular/core';
import {
  IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCheckbox,
  IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonSpinner, IonText, IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { FirstLogin, OnboardingStep } from '../../core/api/models';

/** What the page shows when the tenant cannot be loaded, by the contract's error reason. */
const PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  EMAIL_NOT_VERIFIED: 'Verify your email address using the link we sent, then sign in again.',
  TENANT_NOT_RESOLVED: 'Your account is not part of a tenant yet. Sign up to create one.',
  TENANT_SUSPENDED: 'This tenant is suspended or being deleted. Contact support.',
  TENANT_SELECTION_REQUIRED: 'You belong to several tenants; choose one to continue.',
  NETWORK_ERROR: 'Depot could not be reached. Check your connection and try again.',
};

/**
 * Signed-in home. Calling `GET /v1/tenant` here completes first-login activation; on that call the
 * response carries a read-write API key, which is shown exactly once.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonCard, IonCardHeader,
    IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonCheckbox, IonNote, IonText, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ tenant()?.tenant?.name ?? 'Depot' }}</ion-title>
        <ion-buttons slot="end"><ion-button (click)="signOut()">Sign out</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
        <ion-spinner name="crescent" aria-label="Loading" />
      } @else if (problem()) {
        <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
        <ion-button fill="outline" (click)="load()">Try again</ion-button>
      } @else if (tenant(); as t) {
        @if (t.apiKey) {
          <ion-card color="warning">
            <ion-card-header><ion-card-title>Your first API key</ion-card-title></ion-card-header>
            <ion-card-content>
              <p>Copy it now. It is shown only once and cannot be recovered.</p>
              <code class="secret">{{ t.apiKey }}</code>
              <ion-button size="small" (click)="copy(t.apiKey!)">{{ copied() ? 'Copied' : 'Copy' }}</ion-button>
            </ion-card-content>
          </ion-card>
        }
        <p>
          Tenant <strong>{{ t.tenant.slug }}</strong> · plan {{ t.tenant.plan }} · your role
          {{ t.tenant.role.toLowerCase() }}
        </p>
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
      }
    </ion-content>
  `,
  styles: [`.secret { display: block; word-break: break-all; margin: 0.5rem 0; font-size: 0.95rem; }`],
})
export class DashboardPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly oidc = inject(OidcSecurityService);

  protected readonly loading = signal(true);
  protected readonly problem = signal<string | null>(null);
  protected readonly tenant = signal<FirstLogin | null>(null);
  protected readonly steps = signal<OnboardingStep[]>([]);
  protected readonly copied = signal(false);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.problem.set(null);
    this.api.tenant().subscribe({
      next: (t) => {
        this.tenant.set(t);
        this.api.onboarding().subscribe({
          next: (s) => this.steps.set(s),
          error: () => this.steps.set([]),
        });
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(PROBLEMS[e.reason] ?? `${e.message}${e.requestId ? ` (request ${e.requestId})` : ''}`);
        this.loading.set(false);
      },
    });
  }

  async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    this.copied.set(true);
  }

  signOut(): void {
    this.oidc.logoff().subscribe();
  }
}
