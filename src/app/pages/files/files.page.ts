import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSearchbar, IonSelect,
  IonSelectOption, IonSpinner, IonText,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Namespace, ObjectResult, SearchHit } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { UploadService } from '../../core/upload/upload.service';
import { describeError, formatBytes } from '../../core/ui/format';

interface UploadJob {
  name: string;
  percent: number;
  error?: string;
  result?: ObjectResult;
}

/** Browse and search files, and upload new ones into a namespace. */
@Component({
  selector: 'app-files',
  imports: [
    DatePipe, RouterLink, IonButton, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSearchbar,
    IonSelect, IonSelectOption, IonSpinner, IonText,
  ],
  template: `
    <h1>Files</h1>

    <div class="toolbar">
      <ion-select label="Namespace" labelPlacement="floating" [value]="namespace()"
        (ionChange)="setNamespace($event.detail.value)" interface="popover">
        <ion-select-option value="">All namespaces</ion-select-option>
        @for (n of namespaces(); track n.id) {
          <ion-select-option [value]="n.name">{{ n.name }}</ion-select-option>
        }
      </ion-select>
      <ion-searchbar placeholder="Search by name or reference" [debounce]="400"
        (ionInput)="setQuery($event.detail.value ?? '')" />
    </div>

    @if (session.canWrite()) {
      <div class="upload">
        <input #picker type="file" multiple hidden (change)="onPick(picker)" />
        <ion-button (click)="picker.click()" [disabled]="!uploadTarget()">
          Upload to {{ uploadTarget() || '…' }}
        </ion-button>
        @if (!namespace() && namespaces().length > 1) {
          <ion-note>Choose a namespace above to upload into it; the default namespace is used otherwise.</ion-note>
        }
      </div>
    }

    @for (job of jobs(); track $index) {
      <div class="job">
        <span>{{ job.name }}</span>
        @if (job.error) {
          <ion-text color="danger"><span role="alert">{{ job.error }}</span></ion-text>
        } @else if (job.result; as r) {
          <a [routerLink]="['/app/files', r.objectId]">Uploaded · {{ r.status }}</a>
        } @else {
          <ion-progress-bar [value]="job.percent / 100" [attr.aria-label]="'Uploading ' + job.name" />
        }
      </div>
    }

    @if (problem()) {
      <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
      <ion-button fill="outline" (click)="load(true)">Try again</ion-button>
    } @else if (loading() && hits().length === 0) {
      <ion-spinner name="crescent" aria-label="Loading files" />
    } @else if (hits().length === 0) {
      <p>No files found. New uploads can take a few seconds to appear in search.</p>
    } @else {
      <ion-list>
        @for (hit of hits(); track hit.versionId) {
          <ion-item [routerLink]="['/app/files', hit.objectId]" detail>
            <ion-label>
              <h2>{{ hit.filename }}</h2>
              <p>{{ hit.namespace }} · {{ bytes(hit.size) }} · {{ hit.contentType ?? 'unknown type' }}</p>
            </ion-label>
            <ion-note slot="end">{{ hit.updatedAt | date: 'mediumDate' }}</ion-note>
          </ion-item>
        }
      </ion-list>
      @if (nextCursor()) {
        <ion-button fill="outline" (click)="load(false)" [disabled]="loading()">Load more</ion-button>
      }
    }
  `,
  styles: [`
    .toolbar { display: grid; grid-template-columns: minmax(10rem, 16rem) 1fr; gap: 0.75rem; align-items: center; }
    .upload { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 0.5rem 0; }
    .job { display: grid; gap: 0.25rem; margin: 0.5rem 0; }
    @media (max-width: 40rem) { .toolbar { grid-template-columns: 1fr; } }
  `],
})
export class FilesPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly uploads = inject(UploadService);
  protected readonly session = inject(SessionService);

  protected readonly namespaces = signal<Namespace[]>([]);
  protected readonly namespace = signal('');
  protected readonly hits = signal<SearchHit[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly jobs = signal<UploadJob[]>([]);
  protected readonly bytes = formatBytes;

  private query = '';

  ngOnInit(): void {
    this.api.namespaces().subscribe({ next: (n) => this.namespaces.set(n), error: () => undefined });
    this.load(true);
  }

  /** Where uploads go: the chosen namespace, else `default` when it is the only choice. */
  protected uploadTarget(): string {
    return this.namespace() || (this.namespaces().find((n) => n.name === 'default')?.name ?? this.namespaces()[0]?.name ?? '');
  }

  protected setNamespace(value: string): void {
    this.namespace.set(value ?? '');
    this.load(true);
  }

  protected setQuery(value: string): void {
    if (value !== this.query) {
      this.query = value;
      this.load(true);
    }
  }

  load(reset: boolean): void {
    this.loading.set(true);
    this.problem.set(null);
    this.api.search({
      q: this.query || undefined,
      namespace: this.namespace() || undefined,
      size: 25,
      cursor: reset ? undefined : (this.nextCursor() ?? undefined),
    }).subscribe({
      next: (r) => {
        this.hits.set(reset ? r.items : [...this.hits(), ...r.items]);
        this.nextCursor.set(r.nextCursor ?? null);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e));
        this.loading.set(false);
      },
    });
  }

  protected async onPick(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = '';
    const target = this.uploadTarget();
    for (const file of files) {
      const job: UploadJob = { name: file.name, percent: 0 };
      this.jobs.update((j) => [job, ...j]);
      const update = (patch: Partial<UploadJob>): void =>
        this.jobs.update((j) => j.map((x) => (x === job ? Object.assign(job, patch) : x)));
      try {
        const result = await this.uploads.upload(target, file, (percent) => update({ percent }));
        update({ result });
      } catch (e) {
        update({ error: `${file.name}: ${describeError(ApiError.from(e))}` });
      }
    }
    this.load(true);
  }
}
