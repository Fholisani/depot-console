import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonSpinner, IonText, IonTitle, IonToolbar,
} from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { SessionService } from '../../core/tenant/session.service';
import { BackService } from '../../core/ui/back.service';
import { TenantService } from '../../core/tenant/tenant.service';
import { describeError } from '../../core/ui/format';

/**
 * The signed-in frame: navigation, tenant name, sign out. It activates the session first, so
 * child pages only render once `GET /v1/tenant` has succeeded.
 */
@Component({
  selector: 'app-shell',
  imports: [
    FormsModule, RouterOutlet, RouterLink, RouterLinkActive, IonHeader, IonToolbar, IonTitle,
    IonButtons, IonButton, IonContent, IonSpinner, IonText, IonInput,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ session.tenant()?.name ?? 'Depot' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="signOut()">Sign out</ion-button>
        </ion-buttons>
      </ion-toolbar>
      @if (session.tenant()) {
        <ion-toolbar>
          <nav class="nav" aria-label="Main">
            <a routerLink="/app/dashboard" routerLinkActive="active">Dashboard</a>
            <a routerLink="/app/files" routerLinkActive="active">Files</a>
            <a routerLink="/app/albums" routerLinkActive="active">Albums</a>
            <a routerLink="/app/namespaces" routerLinkActive="active">Folders</a>
            <a routerLink="/app/keys" routerLinkActive="active">Developers</a>
          </nav>
        </ion-toolbar>
      }
    </ion-header>
    <ion-content>
      @if (session.loading() && !session.tenant()) {
        <div class="center"><ion-spinner name="crescent" aria-label="Loading" /></div>
      } @else if (session.error(); as e) {
        <div class="ion-padding">
          <ion-text color="danger"><p role="alert">{{ describeError(e) }}</p></ion-text>
          @if (e.reason === 'TENANT_SELECTION_REQUIRED') {
            <ion-input label="Tenant address" labelPlacement="floating" [(ngModel)]="pick"
              autocapitalize="off" />
            <ion-button [disabled]="!pick" (click)="choose()">Continue</ion-button>
          } @else if (e.reason === 'TENANT_NOT_RESOLVED') {
            <ion-button routerLink="/signup">Create an account</ion-button>
          }
          <ion-button fill="outline" (click)="session.load()">Try again</ion-button>
        </div>
      } @else if (session.tenant()) {
        <div class="page"><router-outlet /></div>
      }
    </ion-content>
  `,
  styles: [`
    .nav { display: flex; gap: 1.25rem; padding: 0 1rem; overflow-x: auto; }
    .nav a { padding: 0.5rem 0; text-decoration: none; color: var(--ion-color-medium);
      border-bottom: 2px solid transparent; white-space: nowrap; }
    .nav a.active { color: var(--ion-color-primary); border-bottom-color: var(--ion-color-primary); }
    .center { display: flex; justify-content: center; padding: 3rem; }
    .page { max-width: 64rem; margin: 0 auto; padding: 1rem; }
  `],
})
export class ShellPage implements OnInit {
  protected readonly session = inject(SessionService);
  /** Created with the shell, so it has seen the page before any detail page opens. */
  private readonly backNav = inject(BackService);
  private readonly oidc = inject(OidcSecurityService);
  private readonly tenants = inject(TenantService);
  private readonly router = inject(Router);

  protected readonly describeError = describeError;
  protected pick = '';
  protected readonly busy = signal(false);

  ngOnInit(): void {
    if (!this.session.tenant()) {
      this.session.load();
    }
  }

  choose(): void {
    this.tenants.select(this.pick.trim().toLowerCase());
    this.session.load();
  }

  signOut(): void {
    this.session.clear();
    this.tenants.select(null);
    this.oidc.logoff().subscribe(() => void this.router.navigateByUrl('/'));
  }
}
