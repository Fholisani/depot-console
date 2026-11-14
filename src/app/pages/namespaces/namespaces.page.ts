import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput, IonItem, IonLabel,
  IonList, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText, IonToggle,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Namespace } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError } from '../../core/ui/format';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Namespaces group files and carry their rules (versioning, retention, public reads). */
@Component({
  selector: 'app-namespaces',
  imports: [
    ReactiveFormsModule, RouterLink, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonInput, IonItem, IonLabel, IonList, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText,
    IonToggle,
  ],
  template: `
    <h1>Namespaces</h1>
    @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    } @else if (items().length === 0) {
      <p>No namespaces yet.</p>
    } @else {
      <ion-list>
        @for (n of items(); track n.id) {
          <ion-item [routerLink]="['/app/namespaces', n.name]" detail>
            <ion-label>
              <h2>{{ n.name }}</h2>
              <p>
                versioning {{ n.versioningMode.toLowerCase() }} · tier {{ n.defaultTier }} ·
                keeps deleted files {{ n.retentionDays }} days
                @if (n.publicRead) { · public reads }
              </p>
            </ion-label>
          </ion-item>
        }
      </ion-list>
    }

    @if (session.canManage()) {
      <ion-card>
        <ion-card-header><ion-card-title>New namespace</ion-card-title></ion-card-header>
        <ion-card-content>
          <form [formGroup]="form" (ngSubmit)="create()" novalidate>
            <ion-input label="Name" labelPlacement="floating" formControlName="name" autocapitalize="off"
              helperText="Lowercase letters, digits and dashes" />
            <ion-select label="Versioning" labelPlacement="floating" formControlName="versioningMode"
              interface="popover">
              <ion-select-option value="ENABLED">Keep every version</ion-select-option>
              <ion-select-option value="SUSPENDED">Suspended</ion-select-option>
              <ion-select-option value="DISABLED">Off</ion-select-option>
            </ion-select>
            <ion-input label="Keep deleted files (days)" labelPlacement="floating" type="number"
              formControlName="retentionDays" />
            <ion-item lines="none">
              <ion-toggle formControlName="publicRead">Allow public reads</ion-toggle>
            </ion-item>
            @if (formProblem()) { <ion-text color="danger"><p role="alert">{{ formProblem() }}</p></ion-text> }
            <ion-button type="submit" [disabled]="form.invalid || creating()">Create namespace</ion-button>
          </form>
        </ion-card-content>
      </ion-card>
    } @else {
      <ion-note>Only owners and admins can create namespaces.</ion-note>
    }
  `,
})
export class NamespacesPage implements OnInit {
  private readonly api = inject(DepotApi);
  protected readonly session = inject(SessionService);

  protected readonly items = signal<Namespace[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<string | null>(null);
  protected readonly formProblem = signal<string | null>(null);
  protected readonly creating = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(NAME_PATTERN)]],
    versioningMode: ['ENABLED' as 'ENABLED' | 'SUSPENDED' | 'DISABLED'],
    retentionDays: [30, [Validators.required, Validators.min(0), Validators.max(3650)]],
    publicRead: [false],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.namespaces().subscribe({
      next: (n) => {
        this.items.set(n);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e));
        this.loading.set(false);
      },
    });
  }

  protected create(): void {
    if (this.form.invalid) {
      return;
    }
    this.creating.set(true);
    this.formProblem.set(null);
    const v = this.form.getRawValue();
    this.api.createNamespace({ ...v, retentionDays: Number(v.retentionDays) }).subscribe({
      next: () => {
        this.creating.set(false);
        this.form.reset({ name: '', versioningMode: 'ENABLED', retentionDays: 30, publicRead: false });
        this.load();
      },
      error: (e: ApiError) => {
        this.creating.set(false);
        this.formProblem.set(describeError(e));
      },
    });
  }
}
