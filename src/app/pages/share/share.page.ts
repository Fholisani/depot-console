import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';
import { DepotApi } from '../../core/api/depot-api.service';
import type { SharedItem, SharedLink } from '../../core/api/models';
import { formatBytes } from '../../core/ui/format';
import type { MediaKind } from '../../core/ui/media';
import { MediaViewer, type ViewerItem, type ViewerSourceFn } from '../../core/ui/media-viewer';
import { currentEnvironment } from '../../core/slot/slot.service';
import { FileTile } from '../files/file-tile';

const KIND_LABEL: Record<string, string> = {
  image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'Document', other: 'File',
};

/**
 * What a visitor sees when they open a share link: no account needed. A file link shows the file
 * with Download; an album link shows a gallery with a full-screen viewer and "Download all".
 */
@Component({
  selector: 'app-share',
  imports: [DatePipe, FileTile, IonButton, IonSpinner, MediaViewer, RouterLink],
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
                <div class="viewer"><img [src]="src()" [alt]="l.filename" (error)="cannotShow.set(true)" /></div>
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

  protected downloadUrl(): string {
    return this.api.sharedContentUrl(this.token, true);
  }

  protected label(l: SharedLink): string {
    return KIND_LABEL[l.kind ?? 'other'] ?? 'File';
  }
}
