import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';

/** Frame for the pages anyone can see: product, pricing, docs, sign-up. */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IonHeader, IonToolbar, IonContent, IonButton],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <div class="container bar">
          <a routerLink="/" class="brand" aria-label="Depot home">
            <span class="logo" aria-hidden="true">▣</span> Depot
          </a>
          <nav aria-label="Site">
            <a routerLink="/pricing" routerLinkActive="active">Pricing</a>
            <a routerLink="/docs" routerLinkActive="active">Docs</a>
          </nav>
          <div class="actions">
            @if (signedIn()) {
              <ion-button routerLink="/app/files">My files</ion-button>
            } @else {
              <ion-button fill="clear" (click)="signIn()">Sign in</ion-button>
              <ion-button routerLink="/signup">Get started</ion-button>
            }
          </div>
        </div>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <router-outlet />
      <footer class="container footer muted">
        <span>© Depot</span>
        <a routerLink="/pricing">Pricing</a>
        <a routerLink="/docs">Docs</a>
        <a [href]="apiBase + '/swagger-ui.html'" target="_blank" rel="noopener">API reference</a>
      </footer>
    </ion-content>
  `,
  styles: [`
    .bar { display: flex; align-items: center; gap: 2rem; height: 56px; }
    .brand { font-weight: 700; font-size: 1.15rem; color: var(--depot-text); text-decoration: none;
      display: flex; align-items: center; gap: 0.4rem; }
    .logo { color: var(--ion-color-primary); font-size: 1.3rem; }
    nav { display: flex; gap: 1.5rem; flex: 1; }
    nav a { color: var(--depot-muted); text-decoration: none; font-weight: 500; }
    nav a.active, nav a:hover { color: var(--depot-text); }
    .actions { display: flex; gap: 0.25rem; }
    .footer { display: flex; gap: 1.5rem; padding: 3rem 1.25rem 2rem; font-size: 0.9rem;
      border-top: 1px solid var(--depot-border); margin-top: 4rem; }
    .footer a { color: var(--depot-muted); }
    @media (max-width: 40rem) { nav { display: none; } .bar { gap: 0.5rem; justify-content: space-between; } }
  `],
})
export class PublicLayout {
  private readonly oidc = inject(OidcSecurityService);
  protected readonly apiBase = inject(APP_CONFIG).apiBase.replace(/\/$/, '');
  protected readonly signedIn = toSignal(
    this.oidc.isAuthenticated$.pipe(map((r) => r.isAuthenticated)), { initialValue: false });

  signIn(): void {
    this.oidc.authorize();
  }
}
