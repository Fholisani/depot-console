import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton, IonInput, IonInputPasswordToggle, IonItem, IonSpinner, IonText,
} from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { SignupResult } from '../../core/api/models';

/** Words the API refuses as tenant addresses (contract: `SignupRequest.slug`). */
const RESERVED = new Set([
  'admin', 'api', 'www', 'depot', 'console', 'status', 'operator', 'public', 's3', 'root', 'system',
  'support', 'help', 'login', 'signup', 'static', 'docs',
]);

/**
 * A tenant address derived from the email's local part plus a short random suffix, so people never
 * have to pick one: "Jane.Doe+x@mail.com" → "jane-doe-k3f9". Always matches `^[a-z0-9][a-z0-9-]{2,30}$`.
 */
export function slugFromEmail(email: string, suffix = randomSuffix()): string {
  let base = (email.split('@')[0] ?? '')
    .split('+')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  if (base.length < 2 || RESERVED.has(base)) {
    base = 'depot';
  }
  return `${base}-${suffix}`;
}

/** "jane.doe@mail.com" → "Jane Doe". Used as the tenant's display name. */
export function nameFromEmail(email: string): string {
  const words = (email.split('@')[0] ?? '').split('+')[0].split(/[._-]+/).filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return (name || email).slice(0, 100);
}

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

const PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  RATE_LIMITED: 'Too many sign-ups from your network. Try again in an hour.',
  NETWORK_ERROR: 'Depot could not be reached. Check your connection and try again.',
  IDENTITY_UNAVAILABLE: 'Sign-up is temporarily unavailable. Try again shortly.',
};

/** Public sign-up: email and password only. Then "check your email", with a resend. */
@Component({
  selector: 'app-signup',
  imports: [
    ReactiveFormsModule, IonButton, IonItem, IonInput, IonInputPasswordToggle, IonText, IonSpinner,
  ],
  template: `
    <div class="container">
      <div class="card narrow">
        @if (done()) {
          <div class="mail" aria-hidden="true">✉</div>
          <h1>Check your email</h1>
          <p>
            We sent a link to <strong>{{ form.controls.email.value }}</strong>. Open it to confirm your
            address, then sign in.
          </p>
          <ion-button expand="block" (click)="signIn()">Sign in</ion-button>
          <ion-button expand="block" fill="clear" [disabled]="resending() || resent()" (click)="resend()">
            {{ resent() ? 'Sent again' : 'Did not get it? Send again' }}
          </ion-button>
          @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }
        } @else {
          <h1>Create your account</h1>
          <p class="muted sub">5 GB free. No card needed.</p>
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <ion-item>
              <ion-input label="Email" labelPlacement="stacked" type="email" formControlName="email"
                autocomplete="email" inputmode="email" placeholder="you@example.com" />
            </ion-item>
            <ion-item>
              <ion-input label="Password" labelPlacement="stacked" type="password"
                formControlName="password" autocomplete="new-password"
                helperText="At least 10 characters, including a number"
                [errorText]="passwordError()">
                <ion-input-password-toggle slot="end" />
              </ion-input>
            </ion-item>
            @if (problem()) {
              <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
            }
            <ion-button type="submit" expand="block" class="ion-margin-top"
              [disabled]="form.invalid || submitting()">
              @if (submitting()) { <ion-spinner name="crescent" /> } @else { Create account }
            </ion-button>
          </form>
          <p class="ion-text-center muted">
            Already have an account? <a href="#" (click)="$event.preventDefault(); signIn()">Sign in</a>
          </p>
        }
      </div>
    </div>
  `,
  styles: [`
    .narrow { max-width: 26rem; margin: 4rem auto; }
    h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
    .sub { margin: 0 0 1.25rem; }
    .mail { font-size: 2rem; color: var(--ion-color-primary); }
    ion-item { --padding-start: 0; --inner-padding-end: 0; margin-bottom: 0.5rem; }
  `],
})
export class SignupPage {
  private readonly api = inject(DepotApi);
  private readonly oidc = inject(OidcSecurityService);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128),
      Validators.pattern(/\d/)]],
  });

  protected readonly submitting = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly done = signal<SignupResult | null>(null);
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);

  protected passwordError(): string {
    const c = this.form.controls.password;
    if (c.hasError('minlength')) {
      return 'Use at least 10 characters.';
    }
    return c.hasError('pattern') ? 'Add at least one number.' : '';
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.problem.set(null);
    const { email, password } = this.form.getRawValue();
    // The address is generated; on the rare clash try a fresh suffix.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await firstValueFrom(this.api.signUp({
          email, password, name: nameFromEmail(email), slug: slugFromEmail(email),
        }));
        this.done.set(result);
        break;
      } catch (e) {
        const err = ApiError.from(e);
        if (err.reason === 'SLUG_TAKEN' && attempt < 3) {
          continue;
        }
        this.problem.set(this.describe(err));
        break;
      }
    }
    this.submitting.set(false);
  }

  private describe(e: ApiError): string {
    if (e.reason === 'VALIDATION_ERROR' && e.field === 'email') {
      return /registered/i.test(e.message)
        ? 'An account with this email already exists. Sign in instead.'
        : 'Enter a valid email address.';
    }
    if (e.reason === 'VALIDATION_ERROR' && e.field === 'password') {
      return 'That password is not allowed. Use at least 10 characters, including a number.';
    }
    return PROBLEMS[e.reason] ?? `${e.message}${e.requestId ? ` (request ${e.requestId})` : ''}`;
  }

  resend(): void {
    this.resending.set(true);
    this.problem.set(null);
    this.api.resendVerification(this.form.controls.email.value).subscribe({
      next: () => {
        this.resent.set(true);
        this.resending.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(this.describe(e));
        this.resending.set(false);
      },
    });
  }

  signIn(): void {
    this.oidc.authorize();
  }
}
