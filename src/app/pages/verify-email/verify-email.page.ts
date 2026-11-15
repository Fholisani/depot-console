import { Component, inject } from '@angular/core';
import { IonButton } from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';

/**
 * Where Keycloak sends the user after they open the verification link (the API's
 * `depot.keycloak.verify-redirect-uri`). Keycloak has already marked the address verified; the first
 * sign-in after this activates the account.
 */
@Component({
  selector: 'app-verify-email',
  imports: [IonButton],
  template: `
    <div class="container">
      <div class="card narrow">
        <div class="tick" aria-hidden="true">✓</div>
        <h1>Your email is confirmed</h1>
        <p class="muted">Sign in to start uploading files.</p>
        <ion-button expand="block" (click)="signIn()">Sign in</ion-button>
      </div>
    </div>
  `,
  styles: [`
    .narrow { max-width: 26rem; margin: 4rem auto; text-align: center; }
    .tick { width: 3rem; height: 3rem; margin: 0 auto 1rem; border-radius: 50%; display: grid;
      place-items: center; background: var(--depot-accent-soft); color: var(--ion-color-primary);
      font-size: 1.5rem; font-weight: 700; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  `],
})
export class VerifyEmailPage {
  private readonly oidc = inject(OidcSecurityService);

  signIn(): void {
    this.oidc.authorize();
  }
}
