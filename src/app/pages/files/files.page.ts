import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  IonButton, IonCheckbox, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSearchbar, IonSelect,
  IonSelectOption, IonSpinner, IonText,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { FileTile, type TileMark } from './file-tile';
import { RowThumb } from './row-thumb';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Observable } from 'rxjs';
import type {
  Album, AlbumRef, FileCounts, FileGroupFilter, ListedFile, Namespace, ObjectResult,
} from '../../core/api/models';
import { DuplicateGuard } from '../../core/upload/duplicate-guard.service';
import { AlbumDialogs } from '../../core/ui/album-dialogs.service';
import { kindOf } from '../../core/ui/media';
import { MediaViewer, type ViewerItem } from '../../core/ui/media-viewer';
import { fileDetails, ownerSource } from '../../core/ui/owner-viewer';
import { SessionService } from '../../core/tenant/session.service';
import { UploadCancelled, UploadPhase, UploadService, UploadTask } from '../../core/upload/upload.service';
import { uploadStatusText } from '../../core/upload/upload-status';
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

/**
 * Browse and search files, upload new ones into a namespace, open them full screen with previous and
 * next, and select files into albums. Opened with `?addTo=<albumId>` it is the album's file picker.
 */
@Component({
  selector: 'app-files',
  imports: [
    DatePipe, FileTile, MediaViewer, RowThumb, RouterLink, IonButton, IonCheckbox, IonItem, IonLabel, IonList, IonNote,
    IonProgressBar, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonText,
  ],
  template: `
    @if (addTo(); as target) {
      <p><a [routerLink]="['/app/albums', target.id]">&larr; {{ target.name }}</a></p>
      <h1>Add files to {{ target.name }}</h1>
      <p class="muted">Tick the files to add, then press Add. Files already in the album are marked ★.</p>
    } @else {
      <h1>Files</h1>
    }

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

    @if (!searching()) {
      <div class="groups" role="tablist" aria-label="File types">
        @for (g of groups; track g.key) {
          @if (g.key === 'all' || g.key === group() || countFor(g.key) > 0) {
            <ion-button size="small" role="tab" [attr.aria-selected]="group() === g.key"
              [fill]="group() === g.key ? 'solid' : 'outline'" (click)="setGroup(g.key)">
              {{ g.label }}@if (counts()) { &nbsp;({{ countFor(g.key) }}) }
            </ion-button>
          }
        }
      </div>
    }
    @if (message()) { <ion-text color="success"><p role="status">{{ message() }}</p></ion-text> }
    @if (session.canWrite() && !addTo()) {
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
          @if (job.phase === 'uploading' || job.phase === 'pausing' || job.phase === 'paused' || job.phase === 'waiting'
            || job.phase === 'queued') {
            <ion-progress-bar [value]="job.percent / 100" [color]="job.phase === 'uploading' ? 'primary' : 'medium'"
              [attr.aria-label]="'Uploading ' + job.name" />
          } @else {
            <ion-progress-bar type="indeterminate" [attr.aria-label]="'Uploading ' + job.name" />
          }
          <div class="controls">
            <ion-note class="status" aria-live="polite">{{ statusText(job) }}</ion-note>
            @if (pausable(job) && job.phase === 'uploading') {
              <ion-button size="small" fill="clear" (click)="pause(job)">Pause</ion-button>
            }
            @if (isPaused(job)) {
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
      <p>{{ emptyText() }}</p>
    } @else {
      <div class="view-switch">
        @if (session.canWrite()) {
          <ion-button size="small" fill="clear" [color]="selecting() ? 'primary' : 'medium'" (click)="toggleSelect()">
            {{ selecting() ? 'Done' : 'Select' }}
          </ion-button>
        }
        <span class="spacer"></span>
        <ion-button size="small" fill="clear" [color]="grid() ? 'primary' : 'medium'" (click)="setGrid(true)"
          aria-label="Show pictures">Pictures</ion-button>
        <ion-button size="small" fill="clear" [color]="grid() ? 'medium' : 'primary'" (click)="setGrid(false)"
          aria-label="Show list">List</ion-button>
      </div>
      @if (selecting()) {
        <div class="select-bar" role="toolbar" aria-label="Selected files">
          <strong aria-live="polite">{{ selected().size }} selected</strong>
          <ion-button size="small" fill="clear" (click)="selectAll()">Select all</ion-button>
          <ion-button size="small" fill="clear" color="medium" (click)="clearSelection()"
            [disabled]="selected().size === 0">Clear</ion-button>
          <span class="spacer"></span>
          @if (addTo(); as target) {
            <ion-button size="small" (click)="addToTarget(target)" [disabled]="selected().size === 0 || busy()">
              Add {{ selected().size }} to {{ target.name }}
            </ion-button>
          } @else {
            <ion-button size="small" (click)="addToNewAlbum()" [disabled]="selected().size === 0 || busy()">
              Add to new album
            </ion-button>
            <ion-button size="small" fill="outline" (click)="addToExistingAlbum()"
              [disabled]="selected().size === 0 || busy()">Add to album</ion-button>
          }
        </div>
      }
      @if (grid()) {
        <div class="grid">
          @for (hit of hits(); track hit.versionId; let i = $index) {
            <app-file-tile [file]="hit" [selecting]="selecting()" [selected]="selected().has(hit.objectId)"
              [mark]="markOf(hit.objectId)" (activate)="onActivate(hit, i)" />
          }
        </div>
      } @else {
      <ion-list>
        @for (hit of hits(); track hit.versionId; let i = $index) {
          <ion-item button (click)="onActivate(hit, i)" [detail]="!selecting()">
            @if (selecting()) {
              <ion-checkbox slot="start" [checked]="selected().has(hit.objectId)"
                [attr.aria-label]="'Select ' + hit.filename" (click)="$event.preventDefault()" />
            }
            <app-row-thumb slot="start" [objectId]="hit.objectId" [filename]="hit.filename"
              [contentType]="hit.contentType" [poster]="hasPoster(hit)" />
            <ion-label>
              <h2>
                {{ hit.filename }}
                @if (markOf(hit.objectId); as m) {
                  <span class="mark" [attr.title]="m === 'shared' ? 'In a shared album' : 'In an album'">{{ m === 'shared' ? '🔗' : '★' }}</span>
                }
              </h2>
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
    @if (viewIndex() !== null) {
      <app-media-viewer [items]="viewerItems()" [index]="viewIndex()!" (indexChange)="onViewerMove($event)"
        [sourceFor]="source" [hasMore]="!!nextCursor()" (more)="loadMoreForViewer()" (close)="closeViewer()"
        [detailsLink]="details" />
    }
  `,
  styles: [`
    .toolbar { display: grid; grid-template-columns: minmax(10rem, 16rem) 1fr; gap: 0.75rem; align-items: center; }
    .upload { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 0.5rem 0; }
    .job { display: grid; gap: 0.25rem; margin: 0.5rem 0; }
    .groups { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.5rem 0; }
    .groups ion-button { margin: 0; --border-radius: 999px; text-transform: none; }
    .status { font-size: 0.85rem; }
    .controls { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
    .view-switch { display: flex; align-items: center; }
    .spacer { flex: 1; }
    .muted { color: var(--ion-color-medium); }
    .select-bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 0.25rem;
      flex-wrap: wrap; padding: 0.4rem 0.6rem; margin: 0.25rem 0; border-radius: 10px;
      background: var(--ion-color-primary-tint, #e8edff); }
    .mark { font-size: 0.8rem; margin-left: 0.35rem; color: #c79100; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem; margin: 0.5rem 0 1rem; }
    .toolbar.single { grid-template-columns: 1fr; }
    @media (max-width: 40rem) { .toolbar { grid-template-columns: 1fr; } }
  `],
})
export class FilesPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly uploads = inject(UploadService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(AlbumDialogs);
  protected readonly session = inject(SessionService);
  protected readonly message = signal<string | null>(null);
  protected readonly busy = signal(false);

  // ---------------------------------------------------------------- selecting into albums
  protected readonly selecting = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** Albums each loaded file is in, from /v1/albums/membership. */
  private readonly membership = signal<ReadonlyMap<string, AlbumRef[]>>(new Map());
  /** The album being filled when opened from an album's "Add files". */
  protected readonly addTo = signal<Album | null>(null);

  // ---------------------------------------------------------------- viewer
  protected readonly viewIndex = signal<number | null>(null);
  protected readonly viewerItems = computed<ViewerItem[]>(() => this.hits().map((h) => ({
    id: h.objectId, filename: h.filename, kind: kindOf(h.filename, h.contentType), size: h.size,
  })));
  protected readonly source = ownerSource(this.api);
  protected readonly details = fileDetails;
  /** True when this page put `?view=` in the history, so closing can go back instead of adding an entry. */
  private pushedView = false;
  private pendingView: string | null = null;

  protected readonly namespaces = signal<Namespace[]>([]);
  protected readonly namespace = signal('');
  protected readonly hits = signal<ListedFile[]>([]);
  /** Type tab: all, pictures, videos, documents, other. */
  protected readonly group = signal<FileGroupFilter>('all');
  protected readonly counts = signal<FileCounts | null>(null);
  protected readonly searching = signal(false);
  private readonly duplicates = inject(DuplicateGuard);
  protected readonly groups: { key: FileGroupFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pictures', label: 'Pictures' },
    { key: 'videos', label: 'Videos' },
    { key: 'documents', label: 'Documents' },
    { key: 'other', label: 'Other' },
  ];
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
    const addTo = this.route.snapshot.queryParamMap.get('addTo');
    if (addTo) {
      this.selecting.set(true);
      this.api.album(addTo).subscribe({
        next: (a) => this.addTo.set(a),
        error: (e: ApiError) => this.problem.set(describeError(e)),
      });
    }
    // `?view=<objectId>` opens the viewer; Back removes it and closes the viewer.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const id = q.get('view');
      if (!id) {
        this.viewIndex.set(null);
        this.pushedView = false;
        return;
      }
      this.pendingView = id;
      this.openPending();
    });
    this.load(true);
  }

  // ---------------------------------------------------------------- viewer

  private openPending(): void {
    const id = this.pendingView;
    if (!id) {
      return;
    }
    const i = this.hits().findIndex((h) => h.objectId === id);
    if (i >= 0) {
      this.pendingView = null;
      if (this.viewIndex() !== i) {
        this.viewIndex.set(i);
      }
    }
  }

  protected onActivate(hit: ListedFile, index: number): void {
    if (this.selecting()) {
      this.toggle(hit.objectId);
      return;
    }
    this.viewIndex.set(index);
    this.pushedView = true;
    void this.router.navigate([], { queryParams: { view: hit.objectId }, queryParamsHandling: 'merge' });
  }

  protected onViewerMove(index: number): void {
    this.viewIndex.set(index);
    const hit = this.hits()[index];
    if (hit) {
      void this.router.navigate([], {
        queryParams: { view: hit.objectId }, queryParamsHandling: 'merge', replaceUrl: true,
      });
    }
  }

  protected closeViewer(): void {
    this.viewIndex.set(null);
    if (this.pushedView) {
      this.pushedView = false;
      history.back();
    } else {
      void this.router.navigate([], { queryParams: { view: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  protected loadMoreForViewer(): void {
    if (this.nextCursor() && !this.loading()) {
      this.load(false);
    }
  }

  // ---------------------------------------------------------------- selecting

  protected toggleSelect(): void {
    this.selecting.update((on) => !on);
    if (!this.selecting()) {
      this.clearSelection();
    }
  }

  private toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selected.set(next);
  }

  /** Every file loaded so far (with the current folder filter or search). */
  protected selectAll(): void {
    this.selected.set(new Set(this.hits().map((h) => h.objectId)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  /** Database-listed videos say whether their poster exists; search hits do not, so they keep the icon. */
  protected hasPoster(f: ListedFile): boolean {
    return 'poster' in f && f.poster === true;
  }

  protected markOf(id: string): TileMark {
    const albums = this.membership().get(id);
    if (!albums?.length) {
      return null;
    }
    return albums.some((a) => a.shared) ? 'shared' : 'album';
  }

  /** Albums of the loaded files, asked in batches of up to 500. */
  private loadMembership(ids: string[]): void {
    const known = this.membership();
    const missing = ids.filter((id) => !known.has(id));
    for (let i = 0; i < missing.length; i += 500) {
      this.api.albumMembership(missing.slice(i, i + 500)).subscribe({
        next: (rows) => {
          const next = new Map(this.membership());
          rows.forEach((r) => next.set(r.objectId, r.albums));
          this.membership.set(next);
        },
        error: () => undefined,      // marks are a hint; the page works without them
      });
    }
  }

  private refreshMembership(ids: string[]): void {
    const next = new Map(this.membership());
    ids.forEach((id) => next.delete(id));
    this.membership.set(next);
    this.loadMembership(ids);
  }

  protected async addToNewAlbum(): Promise<void> {
    const ids = [...this.selected()];
    const answer = await this.dialogs.newAlbum('Add to new album');
    if (!answer) {
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    try {
      const album = await firstValueFrom(this.api.createAlbum({ ...answer, objectIds: ids }));
      this.busy.set(false);
      await this.router.navigate(['/app/albums', album.id]);
    } catch (e) {
      this.busy.set(false);
      this.problem.set(describeError(ApiError.from(e)));
    }
  }

  protected async addToExistingAlbum(): Promise<void> {
    let albums: Album[];
    try {
      albums = await firstValueFrom(this.api.albums());
    } catch (e) {
      this.problem.set(describeError(ApiError.from(e)));
      return;
    }
    if (albums.length === 0) {
      await this.addToNewAlbum();
      return;
    }
    const album = await this.dialogs.pickAlbum(albums);
    if (album) {
      await this.addToTarget(album);
    }
  }

  /** Tells how many are already in the album, then adds the rest. */
  protected async addToTarget(album: Album): Promise<void> {
    const ids = [...this.selected()];
    const already = ids.filter((id) => this.membership().get(id)?.some((a) => a.id === album.id)).length;
    if (!await this.dialogs.confirmAdd(album.name, already, ids.length - already)) {
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    this.api.addToAlbum(album.id, ids).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.message.set(`Added ${r.added} to ${album.name}`
          + (r.alreadyIn > 0 ? ` (${r.alreadyIn} ${r.alreadyIn === 1 ? 'was' : 'were'} already in it).` : '.'));
        this.clearSelection();
        this.refreshMembership(ids);
        if (this.addTo()) {
          void this.router.navigate(['/app/albums', album.id]);
        }
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e, {
          INSUFFICIENT_ROLE: 'You can look at albums but not change them. Ask an owner or admin.',
        }));
      },
    });
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
      this.searching.set(value.trim() !== '');
      this.load(true);
    }
  }
  protected setGroup(value: FileGroupFilter): void {
    if (value !== this.group()) {
      this.group.set(value);
      this.load(true);
    }
  }
  protected countFor(g: FileGroupFilter): number {
    const c = this.counts();
    return c ? c[g] : 0;
  }
  protected emptyText(): string {
    if (this.searching()) {
      return 'No files match your search.';
    }
    const where = this.namespace() ? ` in ${this.namespace()}` : '';
    const label: Record<FileGroupFilter, string> = {
      all: 'files', pictures: 'pictures', videos: 'videos', documents: 'documents', other: 'other files',
    };
    return `No ${label[this.group()]}${where} yet.`;
  }
  /** Counts for the type tabs; a failure only hides the numbers. */
  private loadCounts(): void {
    this.api.fileCounts(this.namespace() || undefined).subscribe({
      next: (c) => this.counts.set(c),
      error: () => this.counts.set(null),
    });
  }

  load(reset: boolean, attempt = 1): void {
    this.loading.set(true);
    this.problem.set(null);
    const cursor = reset ? undefined : (this.nextCursor() ?? undefined);
    const namespace = this.namespace() || undefined;
    // Browsing lists from the database (fast, complete, works while search is down); only typed text
    // goes to search.
    if (reset && !this.searching()) {
      this.loadCounts();
    }
    const page: Observable<{ items: ListedFile[]; nextCursor?: string | null }> = this.searching()
      ? this.api.search({ q: this.query, namespace, size: 25, cursor })
      : this.api.files({ namespace, group: this.group(), size: 50, cursor });
    page.subscribe({
      next: (r) => {
        const hidden = hiddenObjects();
        const items = r.items.filter((h) => !hidden.has(h.objectId));
        this.hits.set(reset ? items : [...this.hits(), ...items]);
        this.nextCursor.set(r.nextCursor ?? null);
        this.loading.set(false);
        this.loadMembership(items.map((h) => h.objectId));
        this.openPending();
        // The viewer's index follows the list; a reset can make it point past the end.
        const v = this.viewIndex();
        if (v !== null && v >= this.hits().length) {
          this.viewIndex.set(null);
        }
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
    const picked = Array.from(input.files ?? []);
    input.value = '';
    const target = this.uploadTarget();
    const { upload: files, skipped } = await this.duplicates.check(target, picked);
    if (skipped.length > 0) {
      this.message.set(`Skipped ${skipped.length} already in ${target}.`);
    }
    if (files.length === 0) {
      return;
    }
    const jobs = files.map((file): UploadJob => ({ id: crypto.randomUUID(), name: file.name, file, target, percent: 0 }));
    this.jobs.update((j) => [...jobs, ...j]);
    // Side by side, so pausing one does not hold up the others.
    await Promise.all(jobs.map((job) => this.run(job)));
    this.load(true);
  }

  /** "Preparing…", "Uploading 42% · 120 MB of 284 MB", "Paused at 42% …", "Finishing…". */
  protected statusText(job: UploadJob): string {
    return uploadStatusText(job.phase, job.percent, job.file?.size);
  }

  /** Paused, or pause requested and the parts already sending are still finishing. */
  protected isPaused(job: UploadJob): boolean {
    return job.phase === 'paused' || job.phase === 'pausing';
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
