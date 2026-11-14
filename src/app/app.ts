import { Component, inject, OnInit } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { SlotService } from './core/slot/slot.service';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      @if (slot.passive()) {
        <div class="passive-banner" role="status">
          You are on the passive (test) slot.
          <button type="button" (click)="slot.setPassive(false)">Back to active</button>
        </div>
      }
      <ion-router-outlet />
    </ion-app>
  `,
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly slot = inject(SlotService);
  private readonly oidc = inject(OidcSecurityService);

  ngOnInit(): void {
    // Completes the sign-in redirect (code exchange) and restores an existing session.
    this.oidc.checkAuth().subscribe();
  }
}
