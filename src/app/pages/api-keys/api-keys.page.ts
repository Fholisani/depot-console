import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput, IonItem,
  IonLabel, IonList, IonNote, IonSpinner, IonText, IonToggle,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { ApiKey, CreatedApiKey } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError } from '../../core/ui/format';

/** API keys for programs and scripts. A new key's secret is shown once. */
@Component({
  selector: 'app-api-keys',
  imports: [
    DatePipe, ReactiveFormsModule, IonBadge, IonButton, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonInput, IonItem, IonLabel, IonList, IonNote, IonSpinner, IonText, IonToggle,
  ],
  template: `
    <h1>API keys</h1>
    <p>Use a key as <code>Authorization: Bearer dpt_…</code> from your own programs.</p>

    @if (created(); as k) {
      <ion-card color="warning">
        <ion-card-header><ion-card-title>Your new key</ion-card-title></ion-card-header>
        <ion-card-content>
          <p>Copy it now. It is shown only once and cannot be recovered.</p>
          <code class="secret">{{ k.key }}</code>
          <ion-button size="small" (click)="copy(k.key)">{{ copied() ? 'Copied' : 'Copy' }}</ion-button>
          <ion-button size="small" fill="outline" (click)="created.set(null)">I have saved it</ion-button>
        </ion-card-content>
      </ion-card>
    }
    @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    } @else {
      <ion-list>
        @for (k of keys(); track k.id) {
          <ion-item>
            <ion-label>
              <h3>
                {{ k.scope.readWrite ? 'Read and write' : 'Read only' }}
                @if (k.revokedAt) { <ion-badge color="medium">Revoked</ion-badge> }
              </h3>
              <p>
                {{ k.scope.namespaces.length ? k.scope.namespaces.join(', ') : 'All namespaces' }} ·
                created {{ k.createdAt | date: 'medium' }}
              </p>
            </ion-label>
            @if (!k.revokedAt && session.canManage()) {
              <ion-button slot="end" fill="clear" color="danger" size="small" (click)="revoke(k)">Revoke</ion-button>
            }
          </ion-item>
        } @empty {
          <ion-item><ion-label>No keys yet.</ion-label></ion-item>
        }
      </ion-list>

      @if (session.canManage()) {
        <ion-card>
          <ion-card-header><ion-card-title>New key</ion-card-title></ion-card-header>
          <ion-card-content>
            <form [formGroup]="form" (ngSubmit)="create()">
              <ion-item lines="none"><ion-toggle formControlName="readWrite">Allow writes</ion-toggle></ion-item>
              <ion-input label="Namespaces (comma separated)" labelPlacement="floating"
                formControlName="namespaces" helperText="Leave empty for all namespaces" />
              <ion-button type="submit" [disabled]="busy()">Create key</ion-button>
            </form>
          </ion-card-content>
        </ion-card>
      } @else {
        <ion-note>Only owners and admins can manage API keys.</ion-note>
      }
    }
  `,
  styles: [`.secret { display: block; word-break: break-all; margin: 0.5rem 0; }`],
})
export class ApiKeysPage implements OnInit {
  private readonly api = inject(DepotApi);
  protected readonly session = inject(SessionService);

  protected readonly keys = signal<ApiKey[]>([]);
  protected readonly created = signal<CreatedApiKey | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    readWrite: [false],
    namespaces: [''],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.apiKeys().subscribe({
      next: (k) => {
        this.keys.set(k);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e));
        this.loading.set(false);
      },
    });
  }

  protected create(): void {
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.problem.set(null);
    this.api.createApiKey({
      readWrite: v.readWrite,
      namespaces: v.namespaces.split(',').map((s) => s.trim()).filter(Boolean),
    }).subscribe({
      next: (k) => {
        this.busy.set(false);
        this.copied.set(false);
        this.created.set(k);
        this.load();
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e));
      },
    });
  }

  protected revoke(k: ApiKey): void {
    if (!confirm('Revoke this key? Programs using it stop working immediately.')) {
      return;
    }
    this.api.revokeApiKey(k.id).subscribe({
      next: () => this.load(),
      error: (e: ApiError) => this.problem.set(describeError(e)),
    });
  }

  protected async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    this.copied.set(true);
  }
}
