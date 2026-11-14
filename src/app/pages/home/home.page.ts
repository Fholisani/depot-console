import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonHeader, IonText, IonTitle, IonToolbar,
} from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map } from 'rxjs';

/** Public landing page: what Depot is, sign in, sign up. */
@Component({
  selector: 'app-home',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonText, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar><ion-title>Depot</ion-title></ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <h1>Object storage you can trust</h1>
      <ion-text>
        <p>
          Store files of any size in namespaces, keep every version, find them with search and tags,
          and let lifecycle rules move or expire them for you.
        </p>
      </ion-text>
      @if (signedIn()) {
        <ion-button routerLink="/dashboard">Go to your dashboard</ion-button>
      } @else {
        <ion-button (click)="signIn()">Sign in</ion-button>
      }
    </ion-content>
  `,
})
export class HomePage {
  private readonly oidc = inject(OidcSecurityService);
  protected readonly signedIn = toSignal(this.oidc.isAuthenticated$.pipe(map((r) => r.isAuthenticated)),
    { initialValue: false });

  signIn(): void {
    this.oidc.authorize();
  }
}
