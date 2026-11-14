import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  IonButton, IonInput, IonItem, IonLabel, IonList, IonNote, IonSpinner, IonText, IonToggle,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { ApiKey, CreatedApiKey } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError } from '../../core/ui/format';

/**
 * Access keys for programs. One click creates a full-access key and copies it; limits are optional
 * under "More options". Most people never need this page.
 */
@Component({
  selector: 'app-api-keys',
  imports: [
    DatePipe, ReactiveFormsModule, IonButton, IonInput, IonItem, IonLabel, IonList, IonNote,
    IonSpinner, IonText, IonToggle,
  ],
  template: `
    <h1>Developers</h1>
    <p>
      Access keys let your own programs upload and download files. You do not need one to use this
      website.
    </p>

    @if (session.canManage()) {
      <ion-button (click)="create()" [disabled]="busy()">
        @if (busy()) { <ion-spinner name="crescent" /> } @else { Create access key }
      </ion-button>
      <details class="more">
        <summary>More options</summary>
        <form [formGroup]="form">
          <ion-item lines="none"><ion-toggle formControlName="readOnly">Read only (no uploads or deletes)</ion-toggle></ion-item>
          <ion-input label="Only these namespaces (comma separated)" labelPlacement="stacked"
            formControlName="namespaces" placeholder="All namespaces" />
        </form>
      </details>
    } @else {
      <ion-note>Ask an owner or admin of this account to create a key.</ion-note>
    }

    @if (created(); as k) {
      <div class="new" role="status">
        <p>
          <strong>{{ copied() ? 'Key copied to your clipboard.' : 'Your new key:' }}</strong>
          Paste it somewhere safe now; it is not shown again.
        </p>
        <code class="secret">{{ k.key }}</code>
        <ion-button size="small" fill="outline" (click)="copy(k.key)">Copy again</ion-button>
        <ion-button size="small" fill="clear" (click)="created.set(null)">Done</ion-button>
        <p class="hint">Use it as <code>Authorization: Bearer {{ k.key.slice(0, 8) }}…</code></p>
      </div>
    }
    @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    } @else if (active().length > 0) {
      <h2>Your keys</h2>
      <ion-list>
        @for (k of active(); track k.id) {
          <ion-item>
            <ion-label>
              <h3>{{ k.scope.readWrite ? 'Full access' : 'Read only' }}</h3>
              <p>
                {{ k.scope.namespaces.length ? k.scope.namespaces.join(', ') : 'All namespaces' }} ·
                created {{ k.createdAt | date: 'mediumDate' }}
              </p>
            </ion-label>
            @if (session.canManage()) {
              <ion-button slot="end" fill="clear" color="danger" size="small" (click)="revoke(k)">Revoke</ion-button>
            }
          </ion-item>
        }
      </ion-list>
      @if (revokedCount() > 0) {
        <ion-note>{{ revokedCount() }} revoked {{ revokedCount() === 1 ? 'key is' : 'keys are' }} hidden.</ion-note>
      }
    }
  `,
  styles: [`
    .more { margin: 0.5rem 0 1rem; }
    .more summary { cursor: pointer; color: var(--ion-color-medium-shade); }
    .new { border: 1px solid var(--ion-color-success); border-radius: 8px; padding: 0.75rem; margin: 1rem 0; }
    .secret { display: block; word-break: break-all; margin: 0.5rem 0; }
    .hint { color: var(--ion-color-medium-shade); font-size: 0.9rem; }
  `],
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
    readOnly: [false],
    namespaces: [''],
  });

  protected active(): ApiKey[] {
    return this.keys().filter((k) => !k.revokedAt);
  }

  protected revokedCount(): number {
    return this.keys().length - this.active().length;
  }

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
      readWrite: !v.readOnly,
      namespaces: v.namespaces.split(',').map((s) => s.trim()).filter(Boolean),
    }).subscribe({
      next: (k) => {
        this.busy.set(false);
        this.created.set(k);
        this.copied.set(false);
        void this.copy(k.key);
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
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
    } catch {
      this.copied.set(false);   // Clipboard blocked (e.g. no permission); the key is still on screen.
    }
  }
}
