import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButton, IonNote, IonProgressBar, IonSpinner, IonText } from '@ionic/angular';
import { DepotApi } from '../../core/api/depot-api.service';
import { ApiError } from '../../core/api/api-error';
import type { SharedItem, SharedLink } from '../../core/api/models';
import { UploadCancelled, type UploadPhase, UploadTask } from '../../core/upload/upload.service';
import { uploadStatusText } from '../../core/upload/upload-status';
import { describeError, formatBytes } from '../../core/ui/format';
import type { MediaKind } from '../../core/ui/media';
import { MediaViewer, type ViewerItem, type ViewerSourceFn } from '../../core/ui/media-viewer';
import { currentEnvironment } from '../../core/slot/slot.service';
import { FileTile } from '../files/file-tile';

/** One file a visitor is adding to the album. */
interface VisitorUpload {
  id: string;
  name: string;
  size: number;
  percent: number;
  phase?: UploadPhase;
  done?: boolean;
  error?: string;
  file: File;
}

/** What a visitor is told when the album refuses a file. */
const VISITOR_PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  INSUFFICIENT_SCOPE: 'The owner has switched off adding files to this album.',
  CONTENT_TYPE_NOT_ALLOWED: 'Only photos and videos can be added to this album.',
  OBJECT_TOO_LARGE: 'This file is too big: files can be at most 2 GB.',
  DAILY_LIMIT_REACHED: 'This album has taken all the files it can for today. Try again tomorrow.',
  RATE_LIMITED: 'Several people are adding files right now. Try again in a few minutes.',
  QUOTA_STORAGE_EXCEEDED: "The album owner's storage is nearly full.",
  VALIDATION_ERROR: 'This file could not be added (empty, or the album is full).',
  RESOURCE_NOT_FOUND: "This link doesn't work anymore.",
};

const KIND_LABEL: Record<string, string> = {
  image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'Document', other: 'File',
};

/**
 * What a visitor sees when they open a share link: no account needed. A file link shows the file
 * with Download; an album link shows a gallery with a full-screen viewer and "Download all".
 */
@Component({
  selector: 'app-share',
  imports: [DatePipe, FileTile, IonButton, IonNote, IonProgressBar, IonSpinner, IonText, MediaViewer, RouterLink],
  template: `
    <section class="container share" [class.wide]="link()?.target === 'album'">
      @if (env !== 'active') {
        <p class="envnote">{{ env === 'dev' ? 'Test mode on this computer' : 'Test version' }}</p>
      }
      @if (link(); as l) {
        @if (l.target === 'album') {
          <h1>{{ l.name }}</h1>
          @if (l.description) { <p class="desc">{{ l.description }}</p> }
          <p class="meta">
            {{ l.itemCount }} {{ l.itemCount === 1 ? 'item' : 'items' }} · {{ bytes(l.size) }}
            @if (l.sharedBy) { · Shared by {{ l.sharedBy }} }
            · {{ l.sharedAt | date: 'd MMM y' }}
          </p>
          @if (l.expiresAt) {
            <p class="muted">This link works until {{ l.expiresAt | date: 'd MMM y, HH:mm' }}.</p>
          }
          @if ((l.itemCount ?? 0) > 0) {
            <ion-button [href]="archiveUrl()" size="default">Download all ({{ bytes(l.size) }})</ion-button>
          }
          @if (l.uploadsAllowed || uploads().length > 0) {
            <div class="addbox">
              @if (l.uploadsAllowed) {
                <input #picker type="file" multiple accept="image/*,video/*" hidden (change)="addFiles(picker)" />
                <ion-button fill="outline" (click)="picker.click()">Add your photos and videos</ion-button>
                <p class="muted">They are added to this album for everyone with the link. Photos and videos only,
                  up to 2 GB each.</p>
              } @else {
                <p class="muted">The owner has switched off adding files to this album.</p>
              }
              @if (uploadSummary(); as sum) {
                <ion-text [color]="sum.failed > 0 ? 'warning' : 'success'"><p role="status">{{ sum.text }}</p></ion-text>
              }
              @for (u of uploads(); track u.id) {
                <div class="job">
                  <span>{{ u.name }}</span>
                  @if (u.error) {
                    <ion-text color="danger"><span role="alert">{{ u.error }}</span></ion-text>
                    @if (l.uploadsAllowed) {
                      <ion-button size="small" fill="outline" (click)="retry(u)">Try again</ion-button>
                    }
                  } @else if (u.done) {
                    <ion-text color="success"><span>✓ Added · {{ bytes(u.size) }}</span></ion-text>
                  } @else {
                    @if (u.phase === 'preparing' || u.phase === 'finishing' || !u.phase) {
                      <ion-progress-bar type="indeterminate" [attr.aria-label]="'Adding ' + u.name" />
                    } @else {
                      <ion-progress-bar [value]="u.percent / 100" [attr.aria-label]="'Adding ' + u.name" />
                    }
                    <ion-note aria-live="polite">{{ status(u) }}</ion-note>
                  }
                </div>
              }
            </div>
          }
          <div class="grid">
            @for (item of items(); track item.objectId; let i = $index) {
              <app-file-tile [file]="item" [pictureUrl]="item.thumbnail ? thumbUrl(item) : null"
                (activate)="viewIndex.set(i)" />
            }
          </div>
          @if (loadingMore()) {
            <ion-spinner name="crescent" aria-label="Loading more" />
          } @else if (cursor()) {
            <ion-button fill="outline" (click)="loadMore()">Show more</ion-button>
          } @else if (items().length === 0) {
            <p class="muted">This album is empty right now.</p>
          }
        } @else {
          @if (!cannotShow()) {
            @switch (l.kind) {
              @case ('image') {
                <div class="viewer">
                  <img [src]="usePreview() && l.thumbnail ? previewSrc() : src()" [alt]="l.filename"
                    (error)="onImageError(l)" />
                </div>
              }
              @case ('video') {
                <div class="viewer">
                  <video [src]="src()" controls playsinline preload="metadata" (error)="cannotShow.set(true)"></video>
                </div>
              }
              @case ('audio') {
                <div class="viewer"><audio [src]="src()" controls (error)="cannotShow.set(true)"></audio></div>
              }
            }
          } @else {
            <p class="muted">This browser can't show the {{ label(l).toLowerCase() }} here. Download it to open it on your device.</p>
          }
          <h1>{{ l.filename }}</h1>
          @if (l.description) { <p class="desc">{{ l.description }}</p> }
          <p class="meta">
            {{ label(l) }} · {{ bytes(l.size) }}
            @if (l.sharedBy) { · Shared by {{ l.sharedBy }} }
            · {{ l.sharedAt | date: 'd MMM y' }}
          </p>
          @if (l.expiresAt) {
            <p class="muted">This link works until {{ l.expiresAt | date: 'd MMM y, HH:mm' }}.</p>
          }
          <ion-button [href]="downloadUrl()" size="large">Download ({{ bytes(l.size) }})</ion-button>
        }
        <p class="muted foot">
          Shared with Depot. <a routerLink="/signup">Get 10 GB free</a> for your own photos, videos and documents.
        </p>
      } @else if (gone()) {
        <h1>This link doesn't work anymore</h1>
        <p class="muted">It may have expired, or the person who shared it stopped sharing. Ask them to send a new link.</p>
      } @else {
        <ion-spinner name="crescent" aria-label="Loading" />
      }
    </section>
    @if (viewIndex() !== null) {
      <app-media-viewer [items]="viewerItems()" [index]="viewIndex()!" (indexChange)="viewIndex.set($event)"
        [sourceFor]="source" [hasMore]="!!cursor()" (more)="loadMore()" (close)="viewIndex.set(null)"
        [downloadUrl]="itemDownload" />
    }
  `,
  styles: [`
    .share { max-width: 46rem; padding: 2.5rem 1.25rem 4rem; text-align: center; }
    .share.wide { max-width: 72rem; }
    .viewer { background: #000; border-radius: 14px; overflow: hidden; margin-bottom: 1.25rem; }
    .viewer img, .viewer video { max-width: 100%; max-height: 65vh; display: block; margin: 0 auto; }
    .viewer audio { width: 100%; background: #fff; display: block; }
    h1 { font-size: 1.6rem; margin: 0.5rem 0; word-break: break-word; }
    .desc { font-size: 1.05rem; white-space: pre-wrap; }
    .meta { color: var(--ion-color-medium); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.6rem;
      margin: 1.25rem 0; text-align: left; }
    .foot { margin-top: 2rem; font-size: 0.9rem; }
    .addbox { margin: 1.25rem auto 0; max-width: 32rem; }
    .addbox .job { display: grid; gap: 0.2rem; text-align: left; padding: 0.4rem 0;
      border-bottom: 1px solid var(--ion-color-light-shade); word-break: break-word; }
    .envnote { background: #fff4d6; color: #7a5a00; border-radius: 8px; padding: 0.3rem 0.6rem; display: inline-block; font-size: 0.85rem; }
    @media (max-width: 30rem) { .grid { grid-template-columns: repeat(3, 1fr); gap: 0.3rem; } }
  `],
})
export class SharePage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
  protected readonly link = signal<SharedLink | null>(null);
  protected readonly gone = signal(false);
  protected readonly cannotShow = signal(false);
  protected readonly bytes = formatBytes;
  protected readonly env = currentEnvironment();

  // ---------------------------------------------------------------- albums
  protected readonly items = signal<SharedItem[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly viewIndex = signal<number | null>(null);
  protected readonly viewerItems = computed<ViewerItem[]>(() => this.items().map((i) => ({
    id: i.objectId, filename: i.filename, kind: i.kind as MediaKind, size: i.size,
  })));

  /** Photos open as the 1600 px preview; everything else streams the file itself. */
  protected readonly source: ViewerSourceFn = async (item) => {
    const shared = this.items().find((i) => i.objectId === item.id);
    if (item.kind === 'image' && shared?.thumbnail) {
      return { kind: 'image', url: this.api.sharedItemUrl(this.token, item.id, 'preview') };
    }
    if (item.kind === 'other') {
      return { kind: 'other', url: null };
    }
    return { kind: item.kind, url: this.api.sharedItemUrl(this.token, item.id, 'content') };
  };

  protected readonly itemDownload = (item: ViewerItem): string =>
    this.api.sharedItemUrl(this.token, item.id, 'content', true);

  ngOnInit(): void {
    this.api.sharedLink(this.token).subscribe({
      next: (l) => {
        this.link.set(l);
        if (l.target === 'album') {
          this.loadMore();
        }
      },
      error: () => this.gone.set(true),
    });
  }

  protected loadMore(): void {
    if (this.loadingMore() || (this.items().length > 0 && !this.cursor())) {
      return;
    }
    this.loadingMore.set(true);
    this.api.sharedItems(this.token, this.cursor() ?? undefined).subscribe({
      next: (page) => {
        this.items.update((list) => [...list, ...page.items]);
        this.cursor.set(page.nextCursor ?? null);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingMore.set(false);
        if (this.items().length === 0) {
          this.gone.set(true);
        }
      },
    });
  }

  // ---------------------------------------------------------------- visitors adding files

  protected readonly uploads = signal<VisitorUpload[]>([]);
  private readonly visitorApi = this.api.visitorUploads(this.token);

  protected readonly uploadSummary = computed(() => {
    const list = this.uploads();
    if (list.length === 0 || list.some((u) => !u.done && !u.error)) {
      return null;
    }
    const added = list.filter((u) => u.done).length;
    const failed = list.filter((u) => u.error).length;
    const parts = [added > 0 ? `${added} added to the album` : '', failed > 0 ? `${failed} failed` : '']
      .filter((x) => x);
    return { text: parts.join(' · ') + '.', failed };
  });

  protected status(u: VisitorUpload): string {
    return uploadStatusText(u.phase, u.percent, u.size);
  }

  protected async addFiles(input: HTMLInputElement): Promise<void> {
    const picked = Array.from(input.files ?? []);
    input.value = '';
    const jobs = picked.map((file): VisitorUpload => ({
      id: crypto.randomUUID(), name: file.name, size: file.size, percent: 0, file,
    }));
    this.uploads.update((list) => [...jobs, ...list]);
    await Promise.all(jobs.map((j) => this.send(j)));
    this.refreshItems();
  }

  protected async retry(u: VisitorUpload): Promise<void> {
    await this.send(u);
    this.refreshItems();
  }

  private update(id: string, patch: Partial<VisitorUpload>): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  /** Sent like the owner's uploads: three at a time, large files in parts that resume. */
  private async send(u: VisitorUpload): Promise<void> {
    this.update(u.id, { error: undefined, done: false, percent: 0, phase: 'queued' });
    const task = new UploadTask(this.visitorApi, `share:${this.token}`, u.file,
      (p) => this.update(u.id, { percent: p.percent, phase: p.phase }), { alwaysParts: true });
    try {
      await task.start();
      this.update(u.id, { done: true, percent: 100 });
    } catch (e) {
      this.update(u.id, {
        error: e instanceof UploadCancelled ? 'Cancelled' : describeError(ApiError.from(e), VISITOR_PROBLEMS),
      });
    }
  }

  /**
   * Shows the new files: the album and its first page again, now and once more shortly after, since a
   * finished file is shown once its checksum is verified (a few seconds).
   */
  private refreshItems(again = true): void {
    this.api.sharedLink(this.token).subscribe({ next: (l) => this.link.set(l), error: () => undefined });
    this.items.set([]);
    this.cursor.set(null);
    this.loadMore();
    if (again) {
      setTimeout(() => this.refreshItems(false), 8000);
    }
  }

  protected thumbUrl(item: SharedItem): string {
    return this.api.sharedItemUrl(this.token, item.objectId, 'thumbnail');
  }

  protected archiveUrl(): string {
    return this.api.sharedArchiveUrl(this.token);
  }

  // ---------------------------------------------------------------- files

  protected src(): string {
    return this.api.sharedContentUrl(this.token);
  }

  /** Photos show the 1600 px preview; the original loads only on Download. */
  protected readonly usePreview = signal(true);

  protected previewSrc(): string {
    return this.api.sharedPreviewUrl(this.token);
  }

  /** A failed preview falls back to the original once; a failed original means "can't show". */
  protected onImageError(l: SharedLink): void {
    if (this.usePreview() && l.thumbnail) {
      this.usePreview.set(false);
    } else {
      this.cannotShow.set(true);
    }
  }

  protected downloadUrl(): string {
    return this.api.sharedContentUrl(this.token, true);
  }

  protected label(l: SharedLink): string {
    return KIND_LABEL[l.kind ?? 'other'] ?? 'File';
  }
}
