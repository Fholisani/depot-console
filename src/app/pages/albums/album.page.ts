import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import {
  IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput, IonNote, IonProgressBar,
  IonSelect, IonSelectOption, IonSpinner, IonText, IonToggle,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Album, AlbumItem, Namespace, Share, ShareItemStat } from '../../core/api/models';
import { currentEnvironment, previewVersion, shareLinkFor } from '../../core/slot/slot.service';
import { SessionService } from '../../core/tenant/session.service';
import { UploadCancelled, UploadPhase, UploadService, UploadTask } from '../../core/upload/upload.service';
import { uploadStatusText } from '../../core/upload/upload-status';
import { DuplicateGuard } from '../../core/upload/duplicate-guard.service';
import { AlbumDialogs } from '../../core/ui/album-dialogs.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { describeError, formatBytes } from '../../core/ui/format';
import { extendedMessage, linkStats, type MediaKind } from '../../core/ui/media';
import { MediaViewer, type ViewerItem } from '../../core/ui/media-viewer';
import {
  albumMessage, canShareNatively, describeItems, messageText, shareNatively, type ShareMessage,
} from '../../core/ui/share-message';
import { fileDetails, ownerSource } from '../../core/ui/owner-viewer';
import { FileTile } from '../files/file-tile';

interface AlbumUpload {
  id: string;
  name: string;
  percent: number;
  size: number;
  phase?: UploadPhase;
  done?: boolean;
  error?: string;
  /** Shown instead of "Added to the album", e.g. for a duplicate that was not uploaded again. */
  note?: string;
}

const PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  INSUFFICIENT_ROLE: 'Your role lets you look at albums but not change them. Ask an owner or admin.',
  INSUFFICIENT_SCOPE: 'This album is shared, and you may not share files from that folder. Ask an owner or admin.',
  RESOURCE_NOT_FOUND: 'That album does not exist any more.',
};

/**
 * One album: its files as a grid with the viewer, and for members: rename, cover, remove, move to
 * the front, add files, upload into the album, delete, and share with link statistics.
 */
@Component({
  selector: 'app-album',
  imports: [
    DatePipe, FileTile, FormsModule, MediaViewer, RouterLink, IonButton, IonCard, IonCardContent, IonCardHeader,
    IonCardTitle, IonInput, IonNote, IonProgressBar, IonSelect, IonSelectOption, IonSpinner, IonText, IonToggle,
  ],
  template: `
    <p><a routerLink="/app/albums">&larr; Albums</a></p>
    @if (album(); as a) {
      <h1>{{ a.name }} @if (a.shared) { <span class="badge">🔗 Shared</span> }
        @if (a.visitorUploads) { <span class="badge visitors">⬆ Visitors can upload</span> }</h1>
      @if (a.description) { <p class="desc">{{ a.description }}</p> }
      <p class="muted">{{ a.itemCount }} {{ a.itemCount === 1 ? 'item' : 'items' }} · {{ bytes(a.totalSize) }}</p>
      @if (message()) { <ion-text color="success"><p role="status">{{ message() }}</p></ion-text> }
      @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

      @if (session.canWrite()) {
        <div class="actions">
          <ion-button size="small" [routerLink]="['/app/files']" [queryParams]="{ addTo: a.id }">Add files</ion-button>
          <input #picker type="file" multiple hidden (change)="upload(picker)" />
          <ion-button size="small" fill="outline" (click)="chooseFolder(picker)" [disabled]="busy()">Upload</ion-button>
          <ion-button size="small" fill="outline" (click)="edit(a)" [disabled]="busy()">Edit name &amp; description</ion-button>
          <ion-button size="small" fill="outline" (click)="chooseCover()" [disabled]="busy() || items().length === 0"
            [color]="choosingCover() ? 'primary' : undefined">
            {{ choosingCover() ? 'Cancel cover' : 'Choose cover' }}</ion-button>
          <ion-button size="small" fill="clear" [color]="selecting() ? 'primary' : 'medium'" (click)="toggleSelect()">
            {{ selecting() ? 'Done' : 'Select' }}
          </ion-button>
          <span class="spacer"></span>
          <ion-button size="small" fill="clear" color="danger" (click)="remove(a)" [disabled]="busy()">Delete album</ion-button>
        </div>
      }
      @if (uploadSummary(); as sum) {
        <ion-text [color]="sum.failed > 0 ? 'warning' : 'success'"><p role="status">{{ sum.text }}</p></ion-text>
        @if (retryable().length > 0) {
          <ion-button size="small" (click)="retryFailed()">Try again for {{ retryable().length }} failed</ion-button>
        }
      }
      @for (u of uploads(); track u.id) {
        <div class="job">
          <span>{{ u.name }}</span>
          @if (u.error) {
            <ion-text color="danger"><span role="alert">{{ u.error }}</span></ion-text>
            @if (canRetry(u)) {
              <ion-button size="small" fill="outline" (click)="retryUpload(u)">Try again</ion-button>
            }
          } @else if (u.done) {
            <ion-text color="success"><span>✓ {{ u.note ?? 'Uploaded · ' + bytes(u.size) + ' · added to the album' }}</span></ion-text>
          } @else {
            @if (u.phase === 'preparing' || u.phase === 'finishing' || !u.phase) {
              <ion-progress-bar type="indeterminate" [attr.aria-label]="'Uploading ' + u.name" />
            } @else {
              <ion-progress-bar [value]="u.percent / 100" [color]="u.phase === 'uploading' ? 'primary' : 'medium'"
                [attr.aria-label]="'Uploading ' + u.name" />
            }
            <div class="controls">
              <ion-note class="status" aria-live="polite">{{ status(u) }}</ion-note>
              @if (canPause(u)) {
                <ion-button size="small" fill="clear" (click)="pauseUpload(u)">Pause</ion-button>
              }
              @if (u.phase === 'paused' || u.phase === 'pausing') {
                <ion-button size="small" fill="clear" (click)="resumeUpload(u)">Resume</ion-button>
              }
              @if (u.phase !== 'finishing') {
                <ion-button size="small" fill="clear" color="medium" (click)="cancelUpload(u)">Cancel</ion-button>
              }
            </div>
          }
        </div>
      }
      @if (selecting()) {
        <div class="select-bar" role="toolbar" aria-label="Selected items">
          <strong aria-live="polite">{{ selected().size }} selected</strong>
          <ion-button size="small" fill="clear" (click)="selectAll()">Select all</ion-button>
          <span class="spacer"></span>
          <ion-button size="small" fill="outline" (click)="moveToFront()" [disabled]="selected().size === 0 || busy()">
            Move to start</ion-button>
          <ion-button size="small" fill="outline" (click)="makeCover()" [disabled]="selected().size !== 1 || busy()">
            Make cover</ion-button>
          <ion-button size="small" color="danger" (click)="removeSelected()" [disabled]="selected().size === 0 || busy()">
            Remove from album</ion-button>
        </div>
      }

      @if (choosingCover()) {
        <ion-text color="primary"><p role="status">Tap the picture to use as the cover. It shows in the album list
          and in link previews (WhatsApp and others).</p></ion-text>
      }
      @if (items().length === 0 && !loadingItems()) {
        <p>This album is empty. Use Add files to pick files you already have, or Upload to add new ones.</p>
      }
      <div class="grid">
        @for (item of items(); track item.objectId; let i = $index) {
          <app-file-tile [file]="item" [selecting]="selecting()" [selected]="selected().has(item.objectId)"
            [mark]="item.objectId === a.coverObjectId ? 'cover' : (item.addedByVisitor ? 'visitor' : null)"
            (activate)="onActivate(item, i)" />
        }
      </div>
      @if (loadingItems()) {
        <ion-spinner name="crescent" aria-label="Loading" />
      } @else if (cursor()) {
        <ion-button fill="outline" (click)="loadItems(false)">Load more</ion-button>
      }

      @if (session.canWrite()) {
        <ion-card>
          <ion-card-header><ion-card-title>Share</ion-card-title></ion-card-header>
          <ion-card-content>
            <ion-toggle [checked]="a.visitorUploads" (ionChange)="setVisitorUploads($any($event).detail.checked)"
              [disabled]="busy()" justify="space-between">Let people with the link add photos and videos</ion-toggle>
            <p class="muted">
              @if (a.visitorUploads) {
                On: anyone with one of this album's links can add photos and videos (up to 2 GB each, 300 a day).
                They go into this album, count against your storage and show as from a visitor. Switch it off
                at any time; it applies straight away.
              } @else {
                Off: people with the link can only look and download.
              }
            </p>
            <p class="muted">
              Anyone with the link can see this album and view or download its files, no account needed.
              Files you add later appear on the same link; files you remove stop working.
            </p>
            @if (environment === 'dev') {
              <ion-note color="warning">Test mode on this computer: links made here only open on this computer.</ion-note>
            } @else if (environment === 'passive') {
              <ion-note color="warning">Test version: links made here open the test version, not the live site.</ion-note>
            }
            <ion-input label="Add a note (optional)" labelPlacement="floating" maxlength="280"
              [(ngModel)]="shareNote" placeholder="e.g. Photos from Sunday" />
            <ion-select label="Link works for" labelPlacement="floating" [(ngModel)]="shareDays" interface="popover">
              <ion-select-option [value]="1">1 day</ion-select-option>
              <ion-select-option [value]="7">7 days</ion-select-option>
              <ion-select-option [value]="30">30 days</ion-select-option>
              <ion-select-option [value]="0">Until I stop sharing</ion-select-option>
            </ion-select>
            <ion-button size="small" (click)="share()" [disabled]="busy() || a.itemCount === 0">Create link</ion-button>
            @for (s of links(); track s.id) {
              <div class="share-row">
                <code class="wrap">{{ shareUrl(s) }}</code>
                @if (s.description) { <ion-note>Note: {{ s.description }}</ion-note> }
                <ion-note>
                  {{ stats(s) }}
                  @if (s.expiresAt) { · until {{ s.expiresAt | date: 'd MMM y' }} } @else { · no end date }
                </ion-note>
                <div>
                  @if (canShare) {
                    <ion-button size="small" (click)="shareSheet(s)">Share…</ion-button>
                  }
                  <ion-button size="small" fill="clear" (click)="copyLink(s)">Copy message</ion-button>
                  <ion-button size="small" fill="clear" (click)="editNote(s)" [disabled]="busy()">Edit note</ion-button>
                  @if (s.expiresAt) {
                    <ion-button size="small" fill="clear" (click)="extend(s)" [disabled]="busy()">Extend</ion-button>
                  }
                  <ion-button size="small" fill="clear" (click)="toggleStats(s)">
                    {{ statsFor() === s.id ? 'Hide' : 'Show' }} views per file</ion-button>
                  <ion-button size="small" fill="clear" color="danger" (click)="stopSharing(s)">Stop sharing</ion-button>
                </div>
                @if (statsFor() === s.id) {
                  @if (itemStats().length === 0) {
                    <ion-note>No file has been opened yet.</ion-note>
                  } @else {
                    <table class="stats">
                      <thead><tr><th>File</th><th>Views</th><th>Downloads</th></tr></thead>
                      <tbody>
                        @for (st of itemStats(); track st.objectId) {
                          <tr><td>{{ st.filename }}</td><td>{{ st.views }}</td><td>{{ st.downloads }}</td></tr>
                        }
                      </tbody>
                    </table>
                  }
                  <ion-note>Counts are page opens, not people: a refresh counts again.</ion-note>
                }
              </div>
            }
          </ion-card-content>
        </ion-card>
      }
    } @else if (problem()) {
      <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
    } @else {
      <ion-spinner name="crescent" aria-label="Loading" />
    }
    @if (viewIndex() !== null) {
      <app-media-viewer [items]="viewerItems()" [index]="viewIndex()!" (indexChange)="viewIndex.set($event)"
        [sourceFor]="source" [hasMore]="!!cursor()" (more)="loadItems(false)" (close)="viewIndex.set(null)"
        [detailsLink]="details" />
    }
  `,
  styles: [`
    .muted { color: var(--ion-color-medium); }
    .desc { white-space: pre-wrap; }
    .badge.visitors { background: #e3f2e1; color: #1b5e20; }
    ion-toggle { width: 100%; margin-bottom: 0.25rem; }
    .badge { font-size: 0.8rem; vertical-align: middle; background: var(--ion-color-light-shade); border-radius: 999px;
      padding: 0.15rem 0.55rem; font-weight: normal; }
    .actions { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; margin: 0.5rem 0; }
    .spacer { flex: 1; }
    .job { display: grid; gap: 0.25rem; margin: 0.4rem 0; font-size: 0.9rem; }
    .job .status { font-size: 0.85rem; }
    .job .controls { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
    .select-bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap;
      padding: 0.4rem 0.6rem; margin: 0.25rem 0; border-radius: 10px; background: var(--ion-color-primary-tint, #e8edff); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem; margin: 0.75rem 0 1rem; }
    .share-row { display: grid; gap: 0.25rem; margin-top: 0.9rem; padding-top: 0.6rem; border-top: 1px solid var(--ion-color-light-shade); }
    .wrap { word-break: break-all; }
    .stats { border-collapse: collapse; font-size: 0.85rem; margin: 0.25rem 0; }
    .stats th, .stats td { text-align: left; padding: 0.2rem 0.75rem 0.2rem 0; }
    .stats td:nth-child(n+2), .stats th:nth-child(n+2) { text-align: right; }
  `],
})
export class AlbumPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(AlbumDialogs);
  private readonly confirm = inject(ConfirmService);
  private readonly uploader = inject(UploadService);
  protected readonly session = inject(SessionService);
  protected readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly environment = currentEnvironment();

  protected readonly album = signal<Album | null>(null);
  protected readonly items = signal<AlbumItem[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loadingItems = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly bytes = formatBytes;
  protected readonly uploads = signal<AlbumUpload[]>([]);
  private namespaces: Namespace[] = [];

  protected readonly selecting = signal(false);
  /** Choose cover mode: the next tile tapped becomes the cover. */
  protected readonly choosingCover = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly viewIndex = signal<number | null>(null);
  protected readonly viewerItems = computed<ViewerItem[]>(() => this.items().map((i) => ({
    id: i.objectId, filename: i.filename, kind: i.kind as MediaKind, size: i.size,
  })));
  protected readonly source = ownerSource(this.api);
  protected readonly details = fileDetails;

  protected shareNote = '';
  protected shareDays = 7;
  protected readonly links = signal<Share[]>([]);
  protected readonly statsFor = signal<string | null>(null);
  protected readonly itemStats = signal<ShareItemStat[]>([]);
  protected readonly canShare = canShareNatively();

  ngOnInit(): void {
    this.reload();
    this.api.namespaces().subscribe({ next: (n) => (this.namespaces = n), error: () => undefined });
  }

  private reload(): void {
    this.api.album(this.id).subscribe({
      next: (a) => {
        this.album.set(a);
        if (this.session.canWrite()) {
          this.loadLinks();
        }
      },
      error: (e: ApiError) => this.problem.set(describeError(e, PROBLEMS)),
    });
    this.loadItems(true);
  }

  protected loadItems(reset: boolean): void {
    if (this.loadingItems() || (!reset && !this.cursor())) {
      return;
    }
    this.loadingItems.set(true);
    this.api.albumItems(this.id, reset ? undefined : (this.cursor() ?? undefined)).subscribe({
      next: (page) => {
        this.items.set(reset ? page.items : [...this.items(), ...page.items]);
        this.cursor.set(page.nextCursor ?? null);
        this.loadingItems.set(false);
      },
      error: (e: ApiError) => {
        this.loadingItems.set(false);
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }

  protected onActivate(item: AlbumItem, index: number): void {
    if (this.choosingCover()) {
      this.setCover(item.objectId);
      return;
    }
    if (this.selecting()) {
      const next = new Set(this.selected());
      if (next.has(item.objectId)) {
        next.delete(item.objectId);
      } else {
        next.add(item.objectId);
      }
      this.selected.set(next);
      return;
    }
    this.viewIndex.set(index);
  }

  protected toggleSelect(): void {
    this.selecting.update((on) => !on);
    this.selected.set(new Set());
  }

  protected selectAll(): void {
    this.selected.set(new Set(this.items().map((i) => i.objectId)));
  }

  // ---------------------------------------------------------------- changing the album

  protected async edit(a: Album): Promise<void> {
    const answer = await this.dialogs.editAlbum(a);
    if (answer) {
      this.run(() => this.api.updateAlbum(a.id, answer), (updated) => {
        this.album.set(updated);
        this.message.set('Album saved.');
      });
    }
  }

  protected moveToFront(): void {
    const chosen = this.items().filter((i) => this.selected().has(i.objectId)).map((i) => i.objectId);
    this.run(() => this.api.reorderAlbum(this.id, chosen), () => {
      this.message.set(`Moved ${chosen.length} to the start.`);
      this.selected.set(new Set());
      this.loadItems(true);
    });
  }

  protected makeCover(): void {
    const [cover] = [...this.selected()];
    this.setCover(cover);
  }

  protected setVisitorUploads(on: boolean): void {
    const a = this.album();
    if (!a || a.visitorUploads === on) {
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    this.message.set(null);
    this.api.updateAlbum(this.id, { visitorUploads: on }).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.album.set(updated);
        if (updated.visitorUploads !== on) {
          this.problem.set('This change is not available yet. Try again later.');
        } else {
          this.message.set(on
            ? 'People with this album\'s links can now add photos and videos.'
            : 'Adding files through links is switched off, and unfinished ones were stopped.');
        }
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.album.set({ ...a });                       // the switch shows what the server has again
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }

  protected chooseCover(): void {
    this.choosingCover.update((on) => !on);
    this.selecting.set(false);
    this.selected.set(new Set());
  }

  private setCover(objectId: string): void {
    this.choosingCover.set(false);
    this.run(() => this.api.updateAlbum(this.id, { coverObjectId: objectId }), (updated) => {
      this.album.set(updated);
      this.message.set(this.links().length > 0
        ? 'Cover changed. Send the link again (Share… or Copy message) for WhatsApp to show the new picture.'
        : 'Cover changed.');
      this.selected.set(new Set());
    });
  }

  protected async extend(s: Share): Promise<void> {
    const choice = await this.dialogs.extendLink(s.expiresAt);
    if (choice) {
      this.run(() => this.api.extendShare(s.id, choice), (updated) => {
        this.message.set(extendedMessage(updated.expiresAt));
        this.loadLinks();
      });
    }
  }

  protected async editNote(s: Share): Promise<void> {
    const note = await this.dialogs.editNote(s.description ?? '');
    if (note === null) {
      return;
    }
    this.run(() => this.api.updateShare(s.id, note || null), () => {
      this.message.set('Note saved. Send the link again for WhatsApp to show it.');
      this.loadLinks();
    });
  }

  protected async removeSelected(): Promise<void> {
    const ids = [...this.selected()];
    if (!await this.confirm.ask({
      header: `Remove ${ids.length} from the album?`,
      message: 'The files stay in Depot; they just leave this album and its link.',
      confirmText: 'Remove', destructive: true,
    })) {
      return;
    }
    this.run(() => this.api.removeFromAlbum(this.id, ids), (r) => {
      this.message.set(`Removed ${r.removed} from the album.`);
      this.selected.set(new Set());
      this.reload();
    });
  }

  protected async remove(a: Album): Promise<void> {
    if (!await this.confirm.ask({
      header: `Delete ${a.name}?`,
      message: a.shared
        ? 'The album and its links go away; anyone with a link loses access. Your files stay.'
        : 'The album goes away. Your files stay.',
      confirmText: 'Delete album', destructive: true,
    })) {
      return;
    }
    this.run(() => this.api.deleteAlbum(a.id), () => void this.router.navigateByUrl('/app/albums'));
  }

  // ---------------------------------------------------------------- uploading into the album

  /** The first time, asks which folder uploads go into and remembers it on the album. */
  protected async chooseFolder(picker: HTMLInputElement): Promise<void> {
    const a = this.album();
    if (!a) {
      return;
    }
    if (!a.uploadNamespace) {
      const fallback = this.namespaces.find((n) => n.name === 'default')?.name ?? this.namespaces[0]?.name ?? 'default';
      if (this.namespaces.length > 1) {
        const chosen = await this.dialogs.pickFolder(this.namespaces, fallback);
        if (!chosen) {
          return;
        }
        try {
          this.album.set(await firstValueFrom(this.api.updateAlbum(a.id, { uploadNamespace: chosen })));
        } catch (e) {
          this.problem.set(describeError(ApiError.from(e), PROBLEMS));
          return;
        }
      } else {
        this.album.set({ ...a, uploadNamespace: fallback });
      }
    }
    picker.click();
  }

  /** Running uploads by job id, for pause, resume and cancel. */
  private readonly tasks = new Map<string, UploadTask>();
  /** The chosen files and when each was first sent, kept so a failed one can be tried again. */
  private readonly files = new Map<string, { file: File; folder: string; startedAt: number }>();
  private readonly duplicateGuard = inject(DuplicateGuard);

  /** One line after a batch: how many uploaded, how much, and where they are in the album. */
  protected readonly uploadSummary = computed(() => {
    const list = this.uploads();
    if (list.length === 0 || list.some((u) => !u.done && !u.error)) {
      return null;
    }
    const ok = list.filter((u) => u.done && !u.note);
    const skipped = list.filter((u) => u.done && u.note);
    const failed = list.filter((u) => u.error && u.error !== 'Cancelled').length;
    const parts: string[] = [];
    if (ok.length > 0) {
      const size = ok.reduce((n, u) => n + u.size, 0);
      parts.push(`${ok.length} uploaded (${this.bytes(size)}), added at the end of the album`);
    }
    if (skipped.length > 0) {
      parts.push(`${skipped.length} already uploaded, added from the folder`);
    }
    if (failed > 0) {
      parts.push(`${failed} failed`);
    }
    return parts.length ? { text: parts.join(' · ') + '.', failed } : null;
  });

  protected status(u: AlbumUpload): string {
    return uploadStatusText(u.phase, u.percent, u.size);
  }

  protected canPause(u: AlbumUpload): boolean {
    return (this.tasks.get(u.id)?.pausable ?? false) && (u.phase === 'uploading' || u.phase === 'waiting');
  }

  protected pauseUpload(u: AlbumUpload): void {
    this.tasks.get(u.id)?.pause();
  }

  protected resumeUpload(u: AlbumUpload): void {
    this.tasks.get(u.id)?.resume();
  }

  protected cancelUpload(u: AlbumUpload): void {
    this.tasks.get(u.id)?.cancel();
  }

  /** Uploads each file into the album's folder and adds it to the album when its upload completes. */
  protected async upload(input: HTMLInputElement): Promise<void> {
    const picked = Array.from(input.files ?? []);
    input.value = '';
    const folder = this.album()?.uploadNamespace ?? 'default';
    const { upload: files, skipped } = await this.duplicateGuard.check(folder, picked);
    if (skipped.length > 0) {
      // Not uploaded again: put the copy already in the folder into the album instead.
      try {
        await firstValueFrom(this.api.addToAlbum(this.id, skipped.map((s) => s.existing.objectId)));
      } catch {
        // shown as unchanged album; the upload of the others still goes ahead
      }
      this.uploads.update((list) => [...skipped.map((s) => ({
        id: crypto.randomUUID(), name: s.file.name, percent: 100, size: s.file.size, done: true,
        note: 'Already uploaded; added to the album',
      })), ...list]);
      if (files.length === 0) {
        this.reload();
        return;
      }
    }
    const jobs = files.map((f) => ({ id: crypto.randomUUID(), name: f.name, percent: 0, size: f.size, file: f }));
    this.uploads.update((list) => [...jobs.map(({ file: _f, ...j }) => j), ...list]);
    jobs.forEach((job) => this.files.set(job.id, { file: job.file, folder, startedAt: Date.now() }));
    await Promise.all(jobs.map((job) => this.sendOne(job.id)));
    this.reload();
  }

  private updateUpload(id: string, patch: Partial<AlbumUpload>): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  /**
   * Sends one chosen file and adds it to the album. A retry first asks whether the folder already got
   * it since the first try (a dropped connection can lose the reply after the file was stored), so it
   * is never stored twice.
   */
  private async sendOne(id: string, retry = false): Promise<void> {
    const chosen = this.files.get(id);
    if (!chosen) {
      return;
    }
    try {
      const task = this.uploader.create(chosen.folder, chosen.file,
        (p) => this.updateUpload(id, { percent: p.percent, phase: p.phase }));
      this.tasks.set(id, task);
      const result = await task.start(retry ? { storedSince: chosen.startedAt } : undefined);
      await firstValueFrom(this.api.addToAlbum(this.id, [result.objectId]));
      this.updateUpload(id, { done: true, percent: 100, error: undefined });
    } catch (e) {
      this.updateUpload(id, {
        error: e instanceof UploadCancelled ? 'Cancelled' : describeError(ApiError.from(e), PROBLEMS),
      });
    } finally {
      this.tasks.delete(id);
    }
  }

  /** Failed (not cancelled) uploads whose file is still at hand. */
  protected readonly retryable = computed(() =>
    this.uploads().filter((u) => this.canRetry(u)));

  protected canRetry(u: AlbumUpload): boolean {
    return !!u.error && u.error !== 'Cancelled' && this.files.has(u.id);
  }

  protected async retryUpload(u: AlbumUpload): Promise<void> {
    this.updateUpload(u.id, { error: undefined, done: false, percent: 0, phase: 'queued' });
    await this.sendOne(u.id, true);
    this.reload();
  }

  protected async retryFailed(): Promise<void> {
    const failed = this.retryable();
    failed.forEach((u) => this.updateUpload(u.id, { error: undefined, done: false, percent: 0, phase: 'queued' }));
    await Promise.all(failed.map((u) => this.sendOne(u.id, true)));
    this.reload();
  }

  // ---------------------------------------------------------------- sharing

  private loadLinks(): void {
    this.api.shares().subscribe({
      next: (all) => this.links.set(all.filter((s) => s.albumId === this.id)),
      error: () => undefined,
    });
  }

  /**
   * The link to send. Its tag changes with the name, description, note and cover, so WhatsApp shows the
   * current preview instead of the one it saved the first time the link was sent.
   */
  protected shareUrl(s: Share): string {
    const a = this.album();
    return shareLinkFor(s.token, previewVersion(a?.name, a?.description, a?.coverObjectId, s.description));
  }

  protected stats(s: Share): string {
    return linkStats(s);
  }

  protected share(): void {
    const note = this.shareNote.trim();
    this.run(() => this.api.shareAlbum(this.id, note || null, this.shareDays || null), (s) => {
      this.shareNote = '';
      void this.copyLink(s);
      this.loadLinks();
      this.album.update((a) => (a ? { ...a, shared: true } : a));
    });
  }

  /** The album's name, the note or description, what it holds and who shared it, then the link. */
  private messageFor(s: Share): ShareMessage {
    const a = this.album();
    const total = a?.itemCount ?? this.items().length;
    const kinds = this.cursor() ? [] : this.items().map((i) => i.kind);
    return albumMessage({ name: a?.name ?? s.name, description: a?.description }, s.description,
      describeItems(kinds, total), this.session.tenant()?.name, this.shareUrl(s));
  }

  /** Opens the phone's share sheet (WhatsApp and others) with the message filled in. */
  protected async shareSheet(s: Share): Promise<void> {
    if (!await shareNatively(this.messageFor(s))) {
      await this.copyLink(s);
    }
  }

  protected async copyLink(s: Share): Promise<void> {
    const text = messageText(this.messageFor(s));
    try {
      await navigator.clipboard.writeText(text);
      this.message.set('Message copied, with the album name and the link. Paste it in a chat to share.');
    } catch {
      this.message.set(text);
    }
  }

  protected toggleStats(s: Share): void {
    if (this.statsFor() === s.id) {
      this.statsFor.set(null);
      return;
    }
    this.statsFor.set(s.id);
    this.itemStats.set([]);
    this.api.shareItemStats(s.id).subscribe({ next: (st) => this.itemStats.set(st), error: () => undefined });
  }

  protected async stopSharing(s: Share): Promise<void> {
    if (!await this.confirm.ask({
      header: 'Stop sharing?',
      message: 'The link stops working straight away for everyone who has it.',
      confirmText: 'Stop sharing', destructive: true,
    })) {
      return;
    }
    this.run(() => this.api.revokeShare(s.id), () => {
      this.message.set('Sharing stopped.');
      this.reload();
    });
  }

  private run<T>(call: () => Observable<T>, ok: (value: T) => void): void {
    this.busy.set(true);
    this.problem.set(null);
    this.message.set(null);
    call().subscribe({
      next: (v) => {
        this.busy.set(false);
        ok(v);
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }
}
