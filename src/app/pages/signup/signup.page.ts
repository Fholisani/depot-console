import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonSpinner, IonText, IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { SignupResult } from '../../core/api/models';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,30}$/;

/** Turns an organisation name into a candidate tenant slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
}

/** Message per failure reason; anything else falls back to the server's message. */
const PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  SLUG_TAKEN: 'That tenant address is taken or reserved. Choose another.',
  RATE_LIMITED: 'Too many sign-ups from your network. Try again in an hour.',
  NETWORK_ERROR: 'Depot could not be reached. Check your connection and try again.',
  IDENTITY_UNAVAILABLE: 'Sign-up is temporarily unavailable. Try again shortly.',
};

/** Public self-service sign-up (`POST /v1/signup`), then "check your email" with a resend. */
@Component({
  selector: 'app-signup',
  imports: [
    ReactiveFormsModule, RouterLink, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonItem, IonInput, IonText, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Create your Depot account</ion-title>
        <ion-buttons slot="end"><ion-button routerLink="/">Back</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (done(); as r) {
        <h2>Check your email</h2>
        <p>{{ r.message }}</p>
        <p>
          Open the link we sent to <strong>{{ form.controls.email.value }}</strong>, then sign in.
        </p>
        <ion-button (click)="signIn()">Sign in</ion-button>
        <ion-button fill="clear" [disabled]="resending() || resent()" (click)="resend()">
          {{ resent() ? 'Sent again' : 'Resend the link' }}
        </ion-button>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <ion-item>
            <ion-input label="Organisation name" labelPlacement="floating" formControlName="name"
              autocomplete="organization" maxlength="100" (ionInput)="suggestSlug()" />
          </ion-item>
          <ion-item>
            <ion-input label="Tenant address" labelPlacement="floating" formControlName="slug"
              helperText="3-31 characters: lowercase letters, digits and dashes"
              autocapitalize="off" (ionInput)="slugEdited = true" />
          </ion-item>
          <ion-item>
            <ion-input label="Email" labelPlacement="floating" type="email" formControlName="email"
              autocomplete="email" />
          </ion-item>
          <ion-item>
            <ion-input label="Password" labelPlacement="floating" type="password"
              formControlName="password" autocomplete="new-password"
              helperText="At least 10 characters, with a digit" />
          </ion-item>
          @if (problem()) {
            <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
          }
          <ion-button type="submit" expand="block" class="ion-margin-top"
            [disabled]="form.invalid || submitting()">
            @if (submitting()) { <ion-spinner name="crescent" /> } @else { Create account }
          </ion-button>
        </form>
        <p class="ion-text-center">
          Already have an account? <a href="#" (click)="$event.preventDefault(); signIn()">Sign in</a>
        </p>
      }
    </ion-content>
  `,
})
export class SignupPage {
  private readonly api = inject(DepotApi);
  private readonly oidc = inject(OidcSecurityService);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    slug: ['', [Validators.required, Validators.pattern(SLUG_PATTERN)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128),
      Validators.pattern(/\d/)]],
  });

  protected slugEdited = false;
  protected readonly submitting = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly done = signal<SignupResult | null>(null);
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);

  /** Follows the organisation name until the user edits the address themselves. */
  suggestSlug(): void {
    if (!this.slugEdited) {
      this.form.controls.slug.setValue(slugify(this.form.controls.name.value));
    }
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.problem.set(null);
    this.api.signUp(this.form.getRawValue()).subscribe({
      next: (r) => {
        this.done.set(r);
        this.submitting.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(PROBLEMS[e.reason] ?? `${e.message}${e.requestId ? ` (request ${e.requestId})` : ''}`);
        this.submitting.set(false);
      },
    });
  }

  resend(): void {
    this.resending.set(true);
    this.api.resendVerification(this.form.controls.email.value).subscribe({
      next: () => this.resent.set(true),
      error: (e: ApiError) => this.problem.set(PROBLEMS[e.reason] ?? e.message),
      complete: () => this.resending.set(false),
    });
  }

  signIn(): void {
    this.oidc.authorize();
  }
}
