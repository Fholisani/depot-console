import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonInput, IonItem, IonLabel, IonList, IonNote, IonSelect, IonSelectOption, IonSpinner,
  IonText, IonToggle,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Namespace } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError } from '../../core/ui/format';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** "Holiday Photos 2026" → "holiday-photos-2026", the form the API accepts for a namespace name. */
export function folderName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

/**
 * Folders (the API's namespaces). Everyone starts with `default`, which is enough for most people;
 * extra folders only matter when groups of files need different rules or separate access keys.
 */
@Component({
  selector: 'app-namespaces',
  imports: [
    ReactiveFormsModule, RouterLink, IonButton, IonInput, IonItem, IonLabel, IonList, IonNote,
    IonSelect, IonSelectOption, IonSpinner, IonText, IonToggle,
  ],
  template: `
    <h1>Folders</h1>
    <p>
      Your files go into the <strong>default</strong> folder unless you make others. Add a folder
      when a group of files needs its own rules, for example files anyone can open with a link, or a
      key that may only touch one project.
    </p>
    @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    } @else {
      <ion-list>
        @for (n of items(); track n.id) {
          <ion-item [routerLink]="['/app/namespaces', n.name]" detail>
            <ion-label>
              <h2>{{ n.name }}</h2>
              <p>
                {{ n.versioningMode === 'ENABLED' ? 'Keeps old versions' : 'No old versions' }} ·
                deleted files recoverable for {{ n.retentionDays }} days
                @if (n.publicRead) { · anyone with the link can open files }
              </p>
            </ion-label>
          </ion-item>
        }
      </ion-list>
    }

    @if (session.canManage()) {
      <h2>New folder</h2>
      <form [formGroup]="form" (ngSubmit)="create()" novalidate class="create">
        <ion-input label="Folder name" labelPlacement="stacked" formControlName="name"
          placeholder="e.g. invoices" autocapitalize="off"
          [helperText]="preview() ? 'Will be saved as ' + preview() : ''" />
        <details>
          <summary>More options</summary>
          <ion-item lines="none">
            <ion-toggle formControlName="publicRead">Anyone with the link can open files</ion-toggle>
          </ion-item>
          <ion-select label="Old versions" labelPlacement="stacked" formControlName="versioningMode"
            interface="popover">
            <ion-select-option value="ENABLED">Keep every version (recommended)</ion-select-option>
            <ion-select-option value="DISABLED">Only keep the latest</ion-select-option>
          </ion-select>
          <ion-input label="Recover deleted files for (days)" labelPlacement="stacked" type="number"
            formControlName="retentionDays" />
        </details>
        @if (formProblem()) { <ion-text color="danger"><p role="alert">{{ formProblem() }}</p></ion-text> }
        <ion-button type="submit" [disabled]="!preview() || creating()">Create folder</ion-button>
      </form>
    } @else {
      <ion-note>Only owners and admins can add folders.</ion-note>
    }
  `,
  styles: [`
    .create { max-width: 30rem; }
    details { margin: 0.5rem 0; }
    summary { cursor: pointer; color: var(--ion-color-medium-shade); }
  `],
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
    name: ['', Validators.required],
    versioningMode: ['ENABLED' as 'ENABLED' | 'DISABLED'],
    retentionDays: [30, [Validators.min(0), Validators.max(3650)]],
    publicRead: [false],
  });

  /** The name as it will be stored, or empty when nothing usable was typed. */
  protected preview(): string {
    const name = folderName(this.form.controls.name.value);
    return NAME_PATTERN.test(name) ? name : '';
  }

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
    const name = this.preview();
    if (!name) {
      return;
    }
    this.creating.set(true);
    this.formProblem.set(null);
    const v = this.form.getRawValue();
    this.api.createNamespace({
      name,
      versioningMode: v.versioningMode,
      retentionDays: Number(v.retentionDays) || 30,
      publicRead: v.publicRead,
    }).subscribe({
      next: () => {
        this.creating.set(false);
        this.form.reset({ name: '', versioningMode: 'ENABLED', retentionDays: 30, publicRead: false });
        this.load();
      },
      error: (e: ApiError) => {
        this.creating.set(false);
        this.formProblem.set(describeError(e, {
          NAMESPACE_EXISTS: 'You already have a folder with that name.',
        }));
      },
    });
  }
}
