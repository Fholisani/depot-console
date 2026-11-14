import { Component, inject } from '@angular/core';
import { IonButton, IonContent, IonHeader, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';

/**
 * Where Keycloak sends the user after they open the verification link (the API's
 * `depot.keycloak.verify-redirect-uri`). Keycloak has already marked the address verified; the first
 * sign-in after this activates the tenant and shows the first API key.
 */
@Component({
  selector: 'app-verify-email',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonText],
  template: `
    <ion-header><ion-toolbar><ion-title>Depot</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <h1>Your email is verified</h1>
      <ion-text>
        <p>Sign in to finish setting up. Your first API key is shown once, right after this sign-in.</p>
      </ion-text>
      <ion-button (click)="signIn()">Sign in</ion-button>
    </ion-content>
  `,
})
export class VerifyEmailPage {
  private readonly oidc = inject(OidcSecurityService);

  signIn(): void {
    this.oidc.authorize();
  }
}
