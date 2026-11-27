import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { AlertController, IonButton, IonItem, IonLabel, IonList, IonSpinner, IonText } from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { OperatorPlanRequest } from '../../core/api/models';
import { describeError, formatBytes, formatMoney } from '../../core/ui/format';

/** The operator's page: plan changes customers asked for, to approve or decline. */
@Component({
  selector: 'app-operator',
  imports: [DatePipe, IonButton, IonItem, IonLabel, IonList, IonSpinner, IonText],
  template: `
    <h1>Plan requests</h1>
    @if (problem()) {
      <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
    }
    @if (requests(); as list) {
      @if (list.length === 0) {
        <p class="muted">Nothing waiting.</p>
      } @else {
        <ion-list lines="full">
          @for (r of list; track r.request.id) {
            <ion-item>
              <ion-label>
                <h3>{{ r.tenantName }} <span class="muted">({{ r.tenantSlug }})</span></h3>
                <p>
                  {{ r.request.fromPlan }} → <strong>{{ r.request.toPlanName }}</strong> ·
                  {{ money(r.request.amountCents, r.request.currency) }} a month
                </p>
                <p>Stores {{ bytes(r.storedBytes) }} · asked {{ r.request.requestedAt | date: 'medium' }}</p>
                <p>
                  @if (r.contactEmail; as email) {
                    Contact <a [href]="'mailto:' + email">{{ email }}</a>
                  } @else {
                    No email on their sign-in
                  }
                </p>
              </ion-label>
              <ion-button slot="end" [disabled]="busy()" (click)="decide(r, true)">Approve</ion-button>
              <ion-button slot="end" fill="outline" color="danger" [disabled]="busy()" (click)="decide(r, false)">
                Decline
              </ion-button>
            </ion-item>
          }
        </ion-list>
      }
    } @else if (!problem()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    }
  `,
  styles: [`h1 { margin: 0.5rem 0 1rem; }`],
})
export class OperatorPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly alerts = inject(AlertController);
  protected readonly requests = signal<OperatorPlanRequest[] | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly bytes = formatBytes;
  protected readonly money = formatMoney;

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.operatorPlanRequests().subscribe({
      next: (r) => {
        this.requests.set(r);
        this.problem.set(null);
      },
      error: (e: ApiError) => this.problem.set(describeError(e)),
    });
  }

  async decide(r: OperatorPlanRequest, approve: boolean): Promise<void> {
    const note = await this.askNote(r, approve);
    if (note === undefined) {
      return;
    }
    this.busy.set(true);
    const call = approve
      ? this.api.approvePlanRequest(r.request.id, note)
      : this.api.rejectPlanRequest(r.request.id, note);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.load();
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e));
        this.load();
      },
    });
  }

  /** The note for the customer; undefined when cancelled, null when left empty. */
  protected async askNote(r: OperatorPlanRequest, approve: boolean): Promise<string | null | undefined> {
    const alert = await this.alerts.create({
      header: approve ? `Approve ${r.request.toPlanName} for ${r.tenantName}?` : `Decline ${r.tenantName}'s request?`,
      message: approve ? 'The new limits apply straight away.' : 'Their plan stays as it is.',
      inputs: [{ name: 'note', type: 'textarea', placeholder: 'Note (optional), e.g. paid by EFT',
        attributes: { maxlength: 200, 'aria-label': 'Note' } }],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: approve ? 'Approve' : 'Decline', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { note?: string } }>();
    if (role !== 'confirm') {
      return undefined;
    }
    return data?.values?.note?.trim() || null;
  }
}
