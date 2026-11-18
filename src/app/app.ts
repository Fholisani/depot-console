import { Component, inject, OnInit } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { SlotService } from './core/slot/slot.service';
import { SignInService } from './core/auth/sign-in.service';

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
      @switch (signIn.state().kind) {
        @case ('slow') {
          <div class="sign-in-problem" role="alert">
            <span>The sign-in service is not responding. It may be busy; please try again.</span>
            <button type="button" (click)="signIn.tryAgain()">Try again</button>
          </div>
        }
        @case ('failed') {
          <div class="sign-in-problem" role="alert">
            <span>Sign-in did not complete. Please try again.</span>
            <button type="button" (click)="signIn.tryAgain()">Try again</button>
            <button type="button" (click)="signIn.dismiss()">Close</button>
          </div>
        }
      }
      <ion-router-outlet />
    </ion-app>
  `,
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly slot = inject(SlotService);
  private readonly oidc = inject(OidcSecurityService);
  protected readonly signIn = inject(SignInService);

  ngOnInit(): void {
    // Completes the sign-in redirect (code exchange) and restores an existing session.
    // A failed callback (e.g. the token exchange timed out) is shown instead of silently signed out.
    this.oidc.checkAuth().subscribe({
      next: (r) => {
        if (!r.isAuthenticated && r.errorMessage && /[?&](code|error)=/.test(window.location.search)) {
          this.signIn.fail(r.errorMessage);
        }
      },
      error: (e: unknown) => this.signIn.fail(e instanceof Error ? e.message : String(e)),
    });
  }
}
