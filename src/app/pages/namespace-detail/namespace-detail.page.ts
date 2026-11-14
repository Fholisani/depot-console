import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Observable } from 'rxjs';
import {
  IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput, IonItem,
  IonLabel, IonList, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText, IonToggle,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type {
  CreatedWebhook, LifecycleRule, LifecycleRuleBody, Namespace, Webhook,
} from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError, formatBytes } from '../../core/ui/format';

const PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  NAMESPACE_NOT_FOUND: 'That namespace does not exist.',
  WEBHOOK_URL_NOT_ALLOWED: 'That address is not allowed. Use a public HTTPS endpoint.',
};

const EVENTS = [
  'object.ready', 'object.corrupted', 'object.copied', 'object.deleted', 'object.updated',
  'object.lifecycle', 'object.purged',
];

/** A namespace's settings, lifecycle rules and webhooks. */
@Component({
  selector: 'app-namespace-detail',
  imports: [
    FormsModule, ReactiveFormsModule, RouterLink, IonBadge, IonButton, IonCard, IonCardHeader,
    IonCardTitle, IonCardContent, IonInput, IonItem, IonLabel, IonList, IonNote, IonSelect,
    IonSelectOption, IonSpinner, IonText, IonToggle,
  ],
  template: `
    <p><a routerLink="/app/namespaces">&larr; Namespaces</a></p>
    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    } @else if (ns(); as n) {
      <h1>{{ n.name }}</h1>
      @if (message()) { <ion-text color="success"><p role="status">{{ message() }}</p></ion-text> }
      @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

      <ion-card>
        <ion-card-header><ion-card-title>Settings</ion-card-title></ion-card-header>
        <ion-card-content>
          <form [formGroup]="settings" (ngSubmit)="saveSettings()">
            <ion-select label="Versioning" labelPlacement="floating" formControlName="versioningMode"
              interface="popover">
              <ion-select-option value="ENABLED">Keep every version</ion-select-option>
              <ion-select-option value="SUSPENDED">Suspended</ion-select-option>
              <ion-select-option value="DISABLED">Off</ion-select-option>
            </ion-select>
            <ion-input label="Default tier" labelPlacement="floating" formControlName="defaultTier" />
            <ion-input label="Keep deleted files (days)" labelPlacement="floating" type="number"
              formControlName="retentionDays" />
            <ion-input label="Allowed browser origins (comma separated)" labelPlacement="floating"
              formControlName="corsOrigins" helperText="For example https://app.example.com, or * for any" />
            <ion-item lines="none"><ion-toggle formControlName="publicRead">Allow public reads</ion-toggle></ion-item>
            <ion-item lines="none">
              <ion-toggle formControlName="verifyBeforeReady">Verify checksums before a file is ready</ion-toggle>
            </ion-item>
            @if (session.canManage()) {
              <ion-button type="submit" [disabled]="settings.invalid || busy()">Save settings</ion-button>
              <ion-button color="danger" fill="outline" (click)="remove()" [disabled]="busy()">
                Delete namespace
              </ion-button>
            }
          </form>
        </ion-card-content>
      </ion-card>

      <h2>Lifecycle rules</h2>
      <ion-list>
        @for (r of rules(); track r.id) {
          <ion-item>
            <ion-label>
              <h3>{{ r.name }} @if (!r.enabled) { <ion-badge color="medium">Off</ion-badge> }</h3>
              <p>{{ describeRule(r) }}</p>
              @if (previews()[r.id]; as p) {
                <ion-note>Would act on {{ p.matched }} versions ({{ bytes(p.bytes) }}) now.</ion-note>
              }
            </ion-label>
            <ion-button slot="end" fill="clear" size="small" (click)="preview(r)">Preview</ion-button>
            @if (session.canManage()) {
              <ion-button slot="end" fill="clear" size="small" (click)="toggleRule(r)">
                {{ r.enabled ? 'Turn off' : 'Turn on' }}
              </ion-button>
              <ion-button slot="end" fill="clear" size="small" color="danger" (click)="deleteRule(r)">Delete</ion-button>
            }
          </ion-item>
        } @empty {
          <ion-item><ion-label>No rules.</ion-label></ion-item>
        }
      </ion-list>
      @if (session.canManage()) {
        <ion-card>
          <ion-card-header><ion-card-title>New rule</ion-card-title></ion-card-header>
          <ion-card-content>
            <form [formGroup]="ruleForm" (ngSubmit)="addRule()">
              <ion-input label="Name" labelPlacement="floating" formControlName="name" />
              <ion-input label="Older than (days)" labelPlacement="floating" type="number"
                formControlName="olderThanDays" />
              <ion-input label="Content type starts with" labelPlacement="floating"
                formControlName="contentTypePrefix" helperText="For example video/" />
              <ion-select label="Action" labelPlacement="floating" formControlName="action" interface="popover">
                <ion-select-option value="transition">Move to another tier</ion-select-option>
                <ion-select-option value="expire">Delete matching files</ion-select-option>
                <ion-select-option value="expireNonCurrent">Purge older versions</ion-select-option>
              </ion-select>
              @if (ruleForm.controls.action.value === 'transition') {
                <ion-input label="Target tier" labelPlacement="floating" formControlName="tier" />
              }
              <ion-button type="submit" [disabled]="ruleForm.invalid || busy()">Add rule</ion-button>
            </form>
          </ion-card-content>
        </ion-card>
      }

      <h2>Webhooks</h2>
      @if (newSecret(); as s) {
        <ion-card color="warning">
          <ion-card-header><ion-card-title>Signing secret</ion-card-title></ion-card-header>
          <ion-card-content>
            <p>Copy it now. It is shown only once.</p>
            <code class="wrap">{{ s.secret }}</code>
            <ion-button size="small" fill="outline" (click)="newSecret.set(null)">I have saved it</ion-button>
          </ion-card-content>
        </ion-card>
      }
      <ion-list>
        @for (w of webhooks(); track w.id) {
          <ion-item>
            <ion-label>
              <h3>{{ w.url }} @if (!w.enabled) { <ion-badge color="medium">Off</ion-badge> }</h3>
              <p>{{ w.events.join(', ') }}
                @if (w.failureCount > 0) { · {{ w.failureCount }} failed deliveries in a row }</p>
            </ion-label>
            @if (session.canManage()) {
              <ion-button slot="end" fill="clear" size="small" (click)="toggleHook(w)">
                {{ w.enabled ? 'Turn off' : 'Turn on' }}
              </ion-button>
              <ion-button slot="end" fill="clear" size="small" color="danger" (click)="deleteHook(w)">Delete</ion-button>
            }
          </ion-item>
        } @empty {
          <ion-item><ion-label>No webhooks.</ion-label></ion-item>
        }
      </ion-list>
      @if (session.canManage()) {
        <ion-card>
          <ion-card-header><ion-card-title>New webhook</ion-card-title></ion-card-header>
          <ion-card-content>
            <form [formGroup]="hookForm" (ngSubmit)="addHook()">
              <ion-input label="HTTPS endpoint" labelPlacement="floating" type="url" formControlName="url" />
              <ion-select label="Events" labelPlacement="floating" formControlName="events" [multiple]="true"
                interface="popover">
                @for (e of events; track e) { <ion-select-option [value]="e">{{ e }}</ion-select-option> }
              </ion-select>
              <ion-button type="submit" [disabled]="hookForm.invalid || busy()">Add webhook</ion-button>
            </form>
          </ion-card-content>
        </ion-card>
      }
    } @else if (problem()) {
      <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
    }
  `,
  styles: [`.wrap { word-break: break-all; display: block; margin: 0.5rem 0; }`],
})
export class NamespaceDetailPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionService);
  private readonly name = inject(ActivatedRoute).snapshot.paramMap.get('name') ?? '';

  protected readonly ns = signal<Namespace | null>(null);
  protected readonly rules = signal<LifecycleRule[]>([]);
  protected readonly webhooks = signal<Webhook[]>([]);
  protected readonly previews = signal<Record<string, { matched: number; bytes: number }>>({});
  protected readonly newSecret = signal<CreatedWebhook | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly bytes = formatBytes;
  protected readonly events = EVENTS;

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly settings = this.fb.group({
    versioningMode: ['ENABLED' as 'ENABLED' | 'SUSPENDED' | 'DISABLED'],
    defaultTier: ['standard', Validators.required],
    retentionDays: [30, [Validators.required, Validators.min(0), Validators.max(3650)]],
    corsOrigins: [''],
    publicRead: [false],
    verifyBeforeReady: [false],
  });
  protected readonly ruleForm = this.fb.group({
    name: ['', Validators.required],
    olderThanDays: [30, [Validators.required, Validators.min(0)]],
    contentTypePrefix: [''],
    action: ['transition' as 'transition' | 'expire' | 'expireNonCurrent'],
    tier: ['archive'],
  });
  protected readonly hookForm = this.fb.group({
    url: ['', [Validators.required, Validators.pattern(/^https:\/\/.+/)]],
    events: [['object.ready', 'object.corrupted']],
  });

  ngOnInit(): void {
    this.api.namespace(this.name).subscribe({
      next: (n) => {
        this.ns.set(n);
        this.settings.reset({
          versioningMode: n.versioningMode,
          defaultTier: n.defaultTier,
          retentionDays: n.retentionDays,
          corsOrigins: n.corsOrigins.join(', '),
          publicRead: n.publicRead,
          verifyBeforeReady: n.verifyBeforeReady,
        });
        if (!this.session.canManage()) {
          this.settings.disable();
        }
        this.loading.set(false);
        this.loadRules();
        this.loadHooks();
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e, PROBLEMS));
        this.loading.set(false);
      },
    });
  }

  private loadRules(): void {
    this.api.lifecycleRules(this.name).subscribe({ next: (r) => this.rules.set(r), error: () => undefined });
  }

  private loadHooks(): void {
    this.api.webhooks(this.name).subscribe({ next: (w) => this.webhooks.set(w), error: () => undefined });
  }

  protected saveSettings(): void {
    const v = this.settings.getRawValue();
    this.act(this.api.updateNamespace(this.name, {
      versioningMode: v.versioningMode,
      defaultTier: v.defaultTier,
      retentionDays: Number(v.retentionDays),
      publicRead: v.publicRead,
      verifyBeforeReady: v.verifyBeforeReady,
      corsOrigins: v.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean),
    }), 'Settings saved.');
  }

  protected remove(): void {
    if (!confirm(`Delete namespace "${this.name}"? It must be empty.`)) {
      return;
    }
    this.busy.set(true);
    this.api.deleteNamespace(this.name).subscribe({
      next: () => void this.router.navigateByUrl('/app/namespaces'),
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }

  protected describeRule(r: LifecycleRule): string {
    const f = r.filter ?? {};
    const when = [
      f.olderThanDays !== undefined ? `older than ${f.olderThanDays} days` : null,
      f.contentTypePrefix ? `type ${f.contentTypePrefix}*` : null,
    ].filter(Boolean).join(', ');
    const what = r.actions.map((a) => (a.type === 'transition' ? `move to ${a.tier}` : a.type)).join(', ');
    return `${what}${when ? ' when ' + when : ''}`;
  }

  protected addRule(): void {
    const v = this.ruleForm.getRawValue();
    const body: LifecycleRuleBody = {
      name: v.name,
      filter: {
        olderThanDays: Number(v.olderThanDays),
        ...(v.contentTypePrefix ? { contentTypePrefix: v.contentTypePrefix } : {}),
      },
      actions: [v.action === 'transition' ? { type: 'transition', tier: v.tier } : { type: v.action }],
    };
    this.act(this.api.createLifecycleRule(this.name, body), 'Rule added.', () => {
      this.ruleForm.controls.name.reset('');
      this.loadRules();
    });
  }

  protected preview(r: LifecycleRule): void {
    this.api.previewLifecycleRule(this.name, r.id).subscribe({
      next: (p) => this.previews.update((m) => ({ ...m, [r.id]: p })),
      error: (e: ApiError) => this.problem.set(describeError(e, PROBLEMS)),
    });
  }

  protected toggleRule(r: LifecycleRule): void {
    this.act(this.api.setLifecycleRuleEnabled(this.name, r.id, !r.enabled), 'Rule updated.', () => this.loadRules());
  }

  protected deleteRule(r: LifecycleRule): void {
    if (confirm(`Delete rule "${r.name}"?`)) {
      this.act(this.api.deleteLifecycleRule(this.name, r.id), 'Rule deleted.', () => this.loadRules());
    }
  }

  protected addHook(): void {
    const v = this.hookForm.getRawValue();
    this.act(this.api.createWebhook(this.name, { url: v.url, events: v.events }), 'Webhook added.', (w) => {
      this.newSecret.set(w);
      this.hookForm.controls.url.reset('');
      this.loadHooks();
    });
  }

  protected toggleHook(w: Webhook): void {
    this.act(this.api.setWebhookEnabled(this.name, w.id, !w.enabled), 'Webhook updated.', () => this.loadHooks());
  }

  protected deleteHook(w: Webhook): void {
    if (confirm(`Delete the webhook for ${w.url}?`)) {
      this.act(this.api.deleteWebhook(this.name, w.id), 'Webhook deleted.', () => this.loadHooks());
    }
  }

  private act<T>(call: Observable<T>, ok: string, after?: (value: T) => void): void {
    this.busy.set(true);
    this.problem.set(null);
    this.message.set(null);
    call.subscribe({
      next: (v) => {
        this.busy.set(false);
        this.message.set(ok);
        after?.(v);
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }
}
