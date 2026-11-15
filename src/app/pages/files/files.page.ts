import { DatePipe } from '@angular/common';
import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSearchbar, IonSelect,
  IonSelectOption, IonSpinner, IonText,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { FileTile } from './file-tile';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Namespace, ObjectResult, SearchHit } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { UploadCancelled, UploadPhase, UploadService, UploadTask } from '../../core/upload/upload.service';
import { hiddenObjects } from '../../core/ui/hidden-objects';
import { describeError, formatBytes } from '../../core/ui/format';

/** Recent uploads survive a reload for the rest of the browser session. */
const RECENT_KEY = 'depot.recentUploads';
const RECENT_MAX = 20;

interface UploadJob {
  id: string;
  name: string;
  cancelled?: boolean;
  /** Present only in the tab that started the upload; needed to retry. */
  file?: File;
  target: string;
  percent: number;
  phase?: UploadPhase;
  error?: string;
  result?: ObjectResult;
}

/** Browse and search files, and upload new ones into a namespace. */
@Component({
  selector: 'app-files',
  imports: [
    DatePipe, FileTile, RouterLink, IonButton, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSearchbar,
    IonSelect, IonSelectOption, IonSpinner, IonText,
  ],
  template: `
    <h1>Files</h1>

    <div class="toolbar" [class.single]="namespaces().length < 2">
      @if (namespaces().length > 1) {
        <ion-select label="Folder" labelPlacement="floating" [value]="namespace()"
          (ionChange)="setNamespace($event.detail.value)" interface="popover">
          <ion-select-option value="">All folders</ion-select-option>
          @for (n of namespaces(); track n.id) {
            <ion-select-option [value]="n.name">{{ n.name }}</ion-select-option>
          }
        </ion-select>
      }
      <ion-searchbar placeholder="Search your files" [debounce]="400"
        (ionInput)="setQuery($event.detail.value ?? '')" />
    </div>

    @if (session.canWrite()) {
      <div class="upload">
        <input #picker type="file" multiple hidden (change)="onPick(picker)" />
        <ion-button (click)="picker.click()" [disabled]="!uploadTarget()">
          {{ namespaces().length > 1 ? 'Upload to ' + uploadTarget() : 'Upload files' }}
        </ion-button>
      </div>
    }

    @for (job of jobs(); track $index) {
      <div class="job">
        <span>{{ job.name }}</span>
        @if (job.error) {
          <ion-text color="danger"><span role="alert">{{ job.error }}</span></ion-text>
          @if (job.file) {
            <ion-button size="small" fill="outline" (click)="retry(job)">Retry</ion-button>
          }
        } @else if (job.cancelled) {
          <ion-note>Cancelled</ion-note>
          @if (job.file) {
            <ion-button size="small" fill="outline" (click)="retry(job)">Upload again</ion-button>
          }
        } @else if (job.result; as r) {
          <a [routerLink]="['/app/files', r.objectId]">Uploaded · {{ r.status }}</a>
        } @else {
          @if (job.phase === 'uploading' || job.phase === 'paused') {
            <ion-progress-bar [value]="job.percent / 100" [color]="job.phase === 'paused' ? 'medium' : 'primary'"
              [attr.aria-label]="'Uploading ' + job.name" />
          } @else {
            <ion-progress-bar type="indeterminate" [attr.aria-label]="'Uploading ' + job.name" />
          }
          <div class="controls">
            <ion-note class="status" aria-live="polite">{{ statusText(job) }}</ion-note>
            @if (pausable(job) && job.phase === 'uploading') {
              <ion-button size="small" fill="clear" (click)="pause(job)">Pause</ion-button>
            }
            @if (job.phase === 'paused') {
              <ion-button size="small" fill="clear" (click)="resume(job)">Resume</ion-button>
            }
            @if (job.phase !== 'finishing') {
              <ion-button size="small" fill="clear" color="medium" (click)="cancel(job)">Cancel</ion-button>
            }
          </div>
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
      <div class="view-switch">
        <ion-button size="small" fill="clear" [color]="grid() ? 'primary' : 'medium'" (click)="setGrid(true)"
          aria-label="Show pictures">Pictures</ion-button>
        <ion-button size="small" fill="clear" [color]="grid() ? 'medium' : 'primary'" (click)="setGrid(false)"
          aria-label="Show list">List</ion-button>
      </div>
      @if (grid()) {
        <div class="grid">
          @for (hit of hits(); track hit.versionId) {
            <app-file-tile [hit]="hit" />
          }
        </div>
      } @else {
      <ion-list>
        @for (hit of hits(); track hit.versionId) {
          <ion-item [routerLink]="['/app/files', hit.objectId]" detail>
            <ion-label>
              <h2>{{ hit.filename }}</h2>
              <p>
                @if (namespaces().length > 1) { {{ hit.namespace }} · }
                {{ bytes(hit.size) }} · {{ hit.contentType ?? 'unknown type' }}
              </p>
            </ion-label>
            <ion-note slot="end">{{ hit.updatedAt | date: 'mediumDate' }}</ion-note>
          </ion-item>
        }
      </ion-list>
      }
      @if (nextCursor()) {
        <ion-button fill="outline" (click)="load(false)" [disabled]="loading()">Load more</ion-button>
      }
    }
  `,
  styles: [`
    .toolbar { display: grid; grid-template-columns: minmax(10rem, 16rem) 1fr; gap: 0.75rem; align-items: center; }
    .upload { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 0.5rem 0; }
    .job { display: grid; gap: 0.25rem; margin: 0.5rem 0; }
    .status { font-size: 0.85rem; }
    .controls { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
    .view-switch { display: flex; justify-content: flex-end; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem; margin: 0.5rem 0 1rem; }
    .toolbar.single { grid-template-columns: 1fr; }
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
  protected readonly jobs = signal<UploadJob[]>(FilesPage.restore());
  /** Running uploads by job id, for pause, resume and cancel. */
  private readonly tasks = new Map<string, UploadTask>();
  protected readonly bytes = formatBytes;
  /** Pictures (gallery) or list; remembered on this device. */
  protected readonly grid = signal(localStorage.getItem('depot.filesView') !== 'list');

  protected setGrid(on: boolean): void {
    this.grid.set(on);
    localStorage.setItem('depot.filesView', on ? 'grid' : 'list');
  }

  private query = '';

  constructor() {
    // Finished uploads are remembered (without the File) so the list survives a reload.
    effect(() => {
      const done = this.jobs()
        .filter((j) => j.result || j.error || j.cancelled)
        .slice(0, RECENT_MAX)
        .map(({ id, name, target, percent, error, result }) => ({ id, name, target, percent, error, result }));
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(done));
    });
  }

  private static restore(): UploadJob[] {
    try {
      return (JSON.parse(sessionStorage.getItem(RECENT_KEY) ?? '[]') as UploadJob[])
        .map((j) => ({ ...j, id: j.id ?? crypto.randomUUID() }));
    } catch {
      return [];
    }
  }

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

  load(reset: boolean, attempt = 1): void {
    this.loading.set(true);
    this.problem.set(null);
    this.api.search({
      q: this.query || undefined,
      namespace: this.namespace() || undefined,
      size: 25,
      cursor: reset ? undefined : (this.nextCursor() ?? undefined),
    }).subscribe({
      next: (r) => {
        const hidden = hiddenObjects();
        const items = r.items.filter((h) => !hidden.has(h.objectId));
        this.hits.set(reset ? items : [...this.hits(), ...items]);
        this.nextCursor.set(r.nextCursor ?? null);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        // Search outages are usually brief: try once more before showing the error.
        if (attempt === 1 && (e.reason === 'SEARCH_UNAVAILABLE' || e.reason === 'NETWORK_ERROR')) {
          setTimeout(() => this.load(reset, 2), 2000);
          return;
        }
        this.problem.set(describeError(e));
        this.loading.set(false);
      },
    });
  }

  protected async onPick(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = '';
    const target = this.uploadTarget();
    const jobs = files.map((file): UploadJob => ({ id: crypto.randomUUID(), name: file.name, file, target, percent: 0 }));
    this.jobs.update((j) => [...jobs, ...j]);
    // Side by side, so pausing one does not hold up the others.
    await Promise.all(jobs.map((job) => this.run(job)));
    this.load(true);
  }

  /** "Preparing…", "Uploading 42% · 120 MB of 284 MB", "Paused at 42% …", "Finishing…". */
  protected statusText(job: UploadJob): string {
    if (job.phase === 'preparing') {
      return 'Preparing…';
    }
    if (job.phase === 'finishing') {
      return 'Finishing…';
    }
    const size = job.file?.size;
    const done = size ? ` · ${this.bytes(Math.round((size * job.percent) / 100))} of ${this.bytes(size)}` : '';
    return job.phase === 'paused' ? `Paused at ${job.percent}%${done}` : `Uploading ${job.percent}%${done}`;
  }

  protected pausable(job: UploadJob): boolean {
    return this.tasks.get(job.id)?.pausable ?? false;
  }

  protected pause(job: UploadJob): void {
    this.tasks.get(job.id)?.pause();
  }

  protected resume(job: UploadJob): void {
    this.tasks.get(job.id)?.resume();
  }

  protected cancel(job: UploadJob): void {
    this.tasks.get(job.id)?.cancel();
  }

  protected async retry(job: UploadJob): Promise<void> {
    await this.run(job);
    this.load(true);
  }

  private async run(job: UploadJob): Promise<void> {
    if (!job.file) {
      return;
    }
    const update = (patch: Partial<UploadJob>): void =>
      this.jobs.update((list) => list.map((x) => (x.id === job.id ? { ...x, ...patch } : x)));
    update({ percent: 0, phase: 'preparing', error: undefined, result: undefined, cancelled: false });
    const task = this.uploads.create(job.target, job.file, (p) => update({ percent: p.percent, phase: p.phase }));
    this.tasks.set(job.id, task);
    try {
      update({ result: await task.start() });
    } catch (e) {
      update(e instanceof UploadCancelled
        ? { cancelled: true }
        : { error: `${job.name}: ${describeError(ApiError.from(e))}` });
    } finally {
      this.tasks.delete(job.id);
    }
  }
}
