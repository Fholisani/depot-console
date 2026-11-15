import { DatePipe } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, Subscription, type Observable } from 'rxjs';
import { hideObject, unhideObject } from '../../core/ui/hidden-objects';
import { ConfirmService } from '../../core/ui/confirm.service';
import { currentEnvironment, shareLinkFor } from '../../core/slot/slot.service';
import {
  IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput, IonItem,
  IonLabel, IonList, IonNote, IonProgressBar, IonSelect, IonSelectOption, IonSpinner, IonText,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { DepotObject, Namespace, Progress, Share, Version, ViewInfo } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError, formatBytes } from '../../core/ui/format';

interface TagRow {
  key: string;
  value: string;
}

/** Download piece size: what a pause can lose at most, and the memory held per request. */
const DOWNLOAD_PIECE = 16 * 1024 * 1024;

const PROBLEMS: Partial<Record<ApiError['reason'], string>> = {
  RESOURCE_NOT_FOUND: 'That file does not exist, or it is not in this tenant.',
  OBJECT_UPLOADING: 'The upload is still in progress.',
  OBJECT_VERIFYING: 'The file is still being verified. Try again in a moment.',
  OBJECT_PROCESSING: 'The file is still being processed. Try again in a moment.',
  OBJECT_CORRUPT: 'The stored file failed its checksum and cannot be downloaded.',
  OBJECT_DELETED: 'This file was deleted and its versions have been purged.',
};

/** One file: metadata, versions, tags, download, copy and delete. */
@Component({
  selector: 'app-object',
  imports: [
    DatePipe, FormsModule, RouterLink, IonBadge, IonButton, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonInput, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSelect,
    IonSelectOption, IonSpinner, IonText,
  ],
  template: `
    <p><a routerLink="/app/files">&larr; Files</a></p>
    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading" />
    } @else if (object(); as o) {
      <h1>{{ o.latest?.filename ?? o.objectId }}</h1>
      <p>
        {{ o.namespace }}
        @if (o.status === 'DELETED') { <ion-badge color="danger">Deleted</ion-badge> }
        @if (o.latest; as l) {
          · {{ bytes(l.size) }} · {{ l.contentType ?? 'unknown type' }} · <ion-badge>{{ l.status }}</ion-badge>
        }
      </p>
      @if (o.externalRef) { <p>Reference: <code>{{ o.externalRef }}</code></p> }
      @if (o.latest?.sha256; as sha) { <p>SHA-256: <code class="wrap">{{ sha }}</code></p> }

      @if (message()) { <ion-text color="success"><p role="status">{{ message() }}</p></ion-text> }
      @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }

      @if (progress(); as p) {
        @if (!p.terminal) {
          <ion-progress-bar [value]="p.percent / 100" aria-label="Processing progress" />
          <ion-note>{{ p.phase }} · {{ p.percent }}%</ion-note>
        }
      }

      @if (downloading(); as d) {
        <div class="dl">
          @if (d.total > 0) {
            <ion-progress-bar [value]="d.loaded / d.total" [attr.aria-label]="'Downloading ' + d.name" />
          } @else {
            <ion-progress-bar type="indeterminate" [attr.aria-label]="'Downloading ' + d.name" />
          }
          <div class="dl-controls">
            <ion-note aria-live="polite">{{ downloadText(d) }}</ion-note>
            @if (d.paused) {
              <ion-button size="small" fill="clear" (click)="resumeDownload()">Resume</ion-button>
            } @else if (d.total > 0) {
              <ion-button size="small" fill="clear" (click)="pauseDownload()">Pause</ion-button>
            }
            <ion-button size="small" fill="clear" color="medium" (click)="cancelDownload()">Cancel</ion-button>
          </div>
        </div>
      }

      @if (view(); as v) {
        @if (v.url && !cannotPlay()) {
          <div class="viewer">
            @switch (v.kind) {
              @case ('image') {
                <img [src]="v.url" [alt]="v.filename" (error)="cannotPlay.set(true)" />
              }
              @case ('video') {
                <video [src]="v.url" controls playsinline preload="metadata"
                  (error)="cannotPlay.set(true)"></video>
              }
              @case ('audio') {
                <audio [src]="v.url" controls (error)="cannotPlay.set(true)"></audio>
              }
              @case ('pdf') {
                <ion-button fill="outline" [href]="v.url" target="_blank" rel="noopener">Open PDF</ion-button>
              }
            }
          </div>
        } @else if (cannotPlay()) {
          <ion-note class="noview">
            Your browser can't show this {{ v.kind === 'video' ? 'video' : 'file' }} here, but it is safe.
            Download it to open it on your device.
          </ion-note>
        }
      }

      <div class="actions">
        @if (o.status === 'ACTIVE') {
          <ion-button (click)="download()" [disabled]="busy()">Download</ion-button>
        }
        @if (session.canWrite()) {
          @if (o.status === 'ACTIVE') {
            <ion-button color="danger" fill="outline" (click)="remove()" [disabled]="busy()">Delete</ion-button>
          } @else {
            <ion-button (click)="undelete()" [disabled]="busy()">Undelete</ion-button>
          }
        }
        @if (session.canManage() && o.status === 'DELETED') {
          <ion-button color="danger" (click)="deleteForever()" [disabled]="busy()">Delete forever</ion-button>
        }
      </div>
      @if (o.status === 'DELETED') {
        <ion-note>
          This file is in the bin. Undelete it, or delete it forever to free its space now; otherwise
          it is removed for good after the folder's recovery period.
        </ion-note>
      }

      @if (session.canWrite() && o.status === 'ACTIVE' && o.latest?.status === 'READY') {
        <ion-card>
          <ion-card-header><ion-card-title>Share</ion-card-title></ion-card-header>
          <ion-card-content>
            <p class="muted">Anyone with the link can see and download this file. No account needed.</p>
            @if (environment === 'dev') {
              <ion-note color="warning">Test mode on this computer: links made here only open on this computer.</ion-note>
            } @else if (environment === 'passive') {
              <ion-note color="warning">Test version: links made here open the test version, not the live site.</ion-note>
            }
            <ion-input label="Add a note (optional)" labelPlacement="floating" maxlength="280"
              [(ngModel)]="shareNote" placeholder="e.g. Our trip to the coast" />
            <ion-select label="Link works for" labelPlacement="floating" [(ngModel)]="shareDays"
              interface="popover">
              <ion-select-option [value]="1">1 day</ion-select-option>
              <ion-select-option [value]="7">7 days</ion-select-option>
              <ion-select-option [value]="30">30 days</ion-select-option>
              <ion-select-option [value]="0">Until I stop sharing</ion-select-option>
            </ion-select>
            <ion-button size="small" (click)="createShare()" [disabled]="busy()">Create link</ion-button>
            @for (s of fileShares(); track s.id) {
              <div class="share-row">
                <code class="wrap">{{ shareUrl(s.token) }}</code>
                <ion-note>
                  {{ s.downloads }} {{ s.downloads === 1 ? 'download' : 'downloads' }}
                  @if (s.expiresAt) { · until {{ s.expiresAt | date: 'd MMM y' }} } @else { · no end date }
                </ion-note>
                <div>
                  <ion-button size="small" fill="clear" (click)="copyLink(s.token)">Copy link</ion-button>
                  <ion-button size="small" fill="clear" color="danger" (click)="stopSharing(s.id)">Stop sharing</ion-button>
                </div>
              </div>
            }
          </ion-card-content>
        </ion-card>
      }

      @if (session.canWrite() && o.status === 'ACTIVE') {
        <ion-card>
          <ion-card-header><ion-card-title>Tags</ion-card-title></ion-card-header>
          <ion-card-content>
            @for (row of tagRows(); track $index) {
              <div class="tag">
                <ion-input label="Key" labelPlacement="floating" [(ngModel)]="row.key" />
                <ion-input label="Value" labelPlacement="floating" [(ngModel)]="row.value" />
                <ion-button fill="clear" color="danger" (click)="removeTag($index)"
                  [attr.aria-label]="'Remove tag ' + row.key">Remove</ion-button>
              </div>
            }
            <ion-button fill="outline" size="small" (click)="addTag()">Add tag</ion-button>
            <ion-button size="small" (click)="saveTags()" [disabled]="busy()">Save tags</ion-button>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header><ion-card-title>Copy</ion-card-title></ion-card-header>
          <ion-card-content>
            <ion-select label="Copy to namespace" labelPlacement="floating" [(ngModel)]="copyTarget"
              interface="popover">
              @for (n of namespaces(); track n.id) {
                <ion-select-option [value]="n.name">{{ n.name }}</ion-select-option>
              }
            </ion-select>
            <ion-button size="small" (click)="copy()" [disabled]="busy() || !copyTarget">Copy</ion-button>
          </ion-card-content>
        </ion-card>
      } @else if (tagRows().length > 0) {
        <h2>Tags</h2>
        <p>@for (row of tagRows(); track $index) { <ion-badge class="tagbadge">{{ row.key }}: {{ row.value }}</ion-badge> }</p>
      }

      <h2>Versions</h2>
      <ion-list>
        @for (v of versions(); track v.versionId) {
          <ion-item>
            <ion-label>
              <h3>
                Version {{ v.versionNo }}
                @if (v.current) { <ion-badge color="success">Current</ion-badge> }
                @if (v.deleteMarker) { <ion-badge color="medium">Delete marker</ion-badge> }
                <ion-badge color="light">{{ v.status }}</ion-badge>
              </h3>
              <p>{{ v.createdAt | date: 'medium' }} · {{ bytes(v.size) }}</p>
            </ion-label>
            @if (!v.deleteMarker) {
              <ion-button slot="end" fill="clear" size="small" (click)="download(v)">Download</ion-button>
            }
            @if (session.canWrite() && !v.current && !v.deleteMarker) {
              <ion-button slot="end" fill="clear" size="small" (click)="restore(v)" [disabled]="busy()">Restore</ion-button>
            }
            @if (session.canManage() && !v.current) {
              <ion-button slot="end" fill="clear" size="small" color="danger" (click)="purge(v)"
                [disabled]="busy()">Purge</ion-button>
            }
          </ion-item>
        }
      </ion-list>
    } @else if (problem()) {
      <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text>
    }
  `,
  styles: [`
    .viewer { margin: 0.75rem 0; background: #000; border-radius: 12px; overflow: hidden; text-align: center; }
    .viewer img, .viewer video { max-width: 100%; max-height: 70vh; display: block; margin: 0 auto; }
    .viewer audio { width: 100%; background: #fff; }
    .noview { display: block; margin: 0.75rem 0; }
    .share-row { display: grid; gap: 0.15rem; margin-top: 0.9rem; padding-top: 0.6rem; border-top: 1px solid var(--ion-color-light-shade); }
    .muted { color: var(--ion-color-medium); }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .dl { display: grid; gap: 0.25rem; margin: 0.75rem 0; font-size: 0.85rem; }
    .dl-controls { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
    .tag { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.5rem; align-items: center; }
    .wrap { word-break: break-all; }
    .tagbadge { margin-right: 0.35rem; }
  `],
})
export class ObjectPage implements OnInit, OnDestroy {
  private readonly api = inject(DepotApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  protected readonly session = inject(SessionService);

  protected readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly object = signal<DepotObject | null>(null);
  protected readonly versions = signal<Version[]>([]);
  protected readonly tagRows = signal<TagRow[]>([]);
  protected readonly namespaces = signal<Namespace[]>([]);
  protected readonly progress = signal<Progress | null>(null);
  protected readonly downloading =
    signal<{ name: string; loaded: number; total: number; paused?: boolean } | null>(null);
  private dl: { name: string; versionId?: string; total: number } | null = null;
  private dlChunks: Blob[] = [];
  private dlSub: Subscription | null = null;
  protected readonly view = signal<ViewInfo | null>(null);
  protected readonly cannotPlay = signal(false);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly bytes = formatBytes;
  protected copyTarget = '';
  protected readonly environment = currentEnvironment();
  protected shareNote = '';
  protected shareDays = 7;
  protected readonly fileShares = signal<Share[]>([]);

  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.reload();
    this.api.namespaces().subscribe({ next: (n) => this.namespaces.set(n), error: () => undefined });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  protected reload(): void {
    this.api.object(this.id).subscribe({
      next: (o) => {
        this.object.set(o);
        this.loading.set(false);
        this.api.versions(this.id).subscribe({ next: (v) => this.versions.set(v), error: () => undefined });
        this.api.tags(this.id).subscribe({
          next: (t) => this.tagRows.set(Object.entries(t).map(([key, value]) => ({ key, value }))),
          error: () => undefined,
        });
        this.watchProgress(o);
        this.loadView(o);
        if (this.session.canWrite() && o.status === 'ACTIVE') {
          this.loadShares();
        }
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e, PROBLEMS));
        this.loading.set(false);
      },
    });
  }

  protected shareUrl(token: string): string {
    return shareLinkFor(token);
  }

  private loadShares(): void {
    this.api.shares().subscribe({
      next: (all) => this.fileShares.set(all.filter((s) => s.objectId === this.id)),
      error: () => undefined,
    });
  }

  protected createShare(): void {
    const note = this.shareNote.trim();
    this.run(() => this.api.createShare(this.id, note || null, this.shareDays || null), (s) => {
      this.shareNote = '';
      void this.copyLink(s.token);
      this.loadShares();
    });
  }

  protected async copyLink(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl(token));
      this.message.set('Link copied. Paste it in a message to share.');
    } catch {
      this.message.set(`Your link: ${this.shareUrl(token)}`);
    }
  }

  protected async stopSharing(shareId: string): Promise<void> {
    if (!await this.confirm.ask({
      header: 'Stop sharing?',
      message: 'The link stops working straight away for everyone who has it.',
      confirmText: 'Stop sharing', destructive: true,
    })) {
      return;
    }
    this.run(() => this.api.revokeShare(shareId), () => {
      this.message.set('Sharing stopped.');
      this.loadShares();
    });
  }

  /** Asks for the viewer URL once the file is ready; failures just mean no preview. */
  private loadView(o: DepotObject): void {
    const ready = o.status === 'ACTIVE' && o.latest?.status === 'READY' && !this.view();
    if (!ready) {
      return;
    }
    this.api.view(this.id).subscribe({ next: (v) => this.view.set(v), error: () => undefined });
  }

  /** Polls while the current version is still uploading or being verified. */
  private watchProgress(o: DepotObject): void {
    clearTimeout(this.timer);
    const status = o.latest?.status;
    if (status !== 'UPLOADING' && status !== 'VERIFYING') {
      this.progress.set(null);
      return;
    }
    this.api.progress(this.id).subscribe({
      next: (p) => {
        this.progress.set(p);
        this.timer = setTimeout(() => (p.terminal ? this.reload() : this.watchProgress(o)), 2000);
      },
      error: () => undefined,
    });
  }

  /** Starts a download with a progress bar; it can be paused, resumed and cancelled. */
  protected download(version?: Version): void {
    const o = this.object();
    this.problem.set(null);
    this.message.set(null);
    this.dlChunks = [];
    this.dl = {
      name: version?.filename ?? o?.latest?.filename ?? 'download',
      // Pin the version so a resumed download continues the same bytes even if a new one appears.
      versionId: version?.versionId ?? o?.currentVersionId ?? undefined,
      total: version?.size ?? o?.latest?.size ?? 0,
    };
    this.busy.set(true);
    this.fetchFrom(0);
  }

  protected pauseDownload(): void {
    this.dlSub?.unsubscribe();
    this.dlSub = null;
    const d = this.downloading();
    if (d) {
      this.downloading.set({ ...d, paused: true });
    }
  }

  protected resumeDownload(): void {
    const d = this.downloading();
    if (d) {
      this.fetchFrom(this.received());
    }
  }

  protected cancelDownload(): void {
    this.dlSub?.unsubscribe();
    this.dlSub = null;
    this.dlChunks = [];
    this.downloading.set(null);
    this.busy.set(false);
  }

  /**
   * Fetches the file in pieces of DOWNLOAD_PIECE bytes from `offset` on (Range requests), so a pause
   * loses at most the piece in flight and resume continues from the last complete piece. When the
   * size is unknown the whole file is fetched in one request.
   */
  private fetchFrom(offset: number): void {
    const meta = this.dl;
    if (!meta) {
      return;
    }
    const whole = meta.total <= 0;
    const range = whole ? undefined : { from: offset, to: Math.min(offset + DOWNLOAD_PIECE, meta.total) - 1 };
    this.downloading.set({ name: meta.name, loaded: offset, total: meta.total, paused: false });
    this.dlSub = this.api.download(this.id, meta.versionId, range).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.DownloadProgress) {
          this.downloading.set({ name: meta.name, loaded: offset + event.loaded, total: meta.total, paused: false });
        } else if (event.type === HttpEventType.Response && event.body) {
          // 206 is the requested piece; a 200 is the whole file (the server ignored the range).
          this.dlChunks = event.status === 206 ? [...this.dlChunks, event.body] : [event.body];
          const got = this.received();
          if (event.status === 206 && got < meta.total) {
            this.fetchFrom(got);
            return;
          }
          this.save(new Blob(this.dlChunks), meta.name);
          this.dlChunks = [];
          this.dlSub = null;
          this.downloading.set(null);
          this.busy.set(false);
          this.message.set(`${meta.name} downloaded.`);
        }
      },
      error: (e: ApiError) => {
        this.dlSub = null;
        this.downloading.set(null);
        this.busy.set(false);
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }

  /** Bytes of the pieces received so far. */
  private received(): number {
    return this.dlChunks.reduce((n, b) => n + b.size, 0);
  }

  /** "Downloading 42% · 20 MB of 48 MB", "Paused at 42% …", or just the bytes when the size is unknown. */
  protected downloadText(d: { loaded: number; total: number; paused?: boolean }): string {
    const verb = d.paused ? 'Paused at' : 'Downloading';
    if (d.total > 0) {
      const pct = Math.min(100, Math.floor((d.loaded / d.total) * 100));
      return `${verb} ${pct}% · ${this.bytes(d.loaded)} of ${this.bytes(d.total)}`;
    }
    return `${verb} · ${this.bytes(d.loaded)}`;
  }

  private save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // Give the browser a moment to start the save before the blob URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  protected async remove(): Promise<void> {
    if (!await this.confirm.ask({
      header: 'Delete this file?',
      message: 'It moves to the bin. You can undelete it until the folder\'s recovery period ends.',
      confirmText: 'Delete', destructive: true,
    })) {
      return;
    }
    this.run(() => this.api.deleteObject(this.id), () => {
      hideObject(this.id);
      void this.router.navigateByUrl('/app/files');
    });
  }

  protected undelete(): void {
    this.run(() => this.api.undeleteObject(this.id), () => {
      unhideObject(this.id);
      this.done('File restored.');
    });
  }

  /** Purges every version of a deleted file, then returns to the list. Cannot be undone. */
  protected async deleteForever(): Promise<void> {
    if (!await this.confirm.ask({
      header: 'Delete forever?',
      message: 'All versions of this file are removed and it cannot be recovered.',
      confirmText: 'Delete forever', destructive: true,
    })) {
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    try {
      for (const v of this.versions()) {
        await firstValueFrom(this.api.purgeVersion(this.id, v.versionId));
      }
      hideObject(this.id);
      await this.router.navigateByUrl('/app/files');
    } catch (e) {
      this.problem.set(describeError(ApiError.from(e), PROBLEMS));
      this.busy.set(false);
      this.reload();
    }
  }

  protected restore(v: Version): void {
    this.run(() => this.api.restoreVersion(this.id, v.versionId), () => this.done(`Version ${v.versionNo} restored as the current version.`));
  }

  protected async purge(v: Version): Promise<void> {
    if (!await this.confirm.ask({
      header: `Delete version ${v.versionNo} forever?`,
      message: 'This version is removed for good. Other versions stay.',
      confirmText: 'Delete forever', destructive: true,
    })) {
      return;
    }
    this.run(() => this.api.purgeVersion(this.id, v.versionId), () => this.done('Version purged.'));
  }

  protected addTag(): void {
    this.tagRows.update((r) => [...r, { key: '', value: '' }]);
  }

  protected removeTag(i: number): void {
    this.tagRows.update((r) => r.filter((_, idx) => idx !== i));
  }

  protected saveTags(): void {
    const tags: Record<string, string> = {};
    for (const row of this.tagRows()) {
      if (row.key.trim()) {
        tags[row.key.trim()] = row.value;
      }
    }
    this.run(() => this.api.replaceTags(this.id, tags), () => this.done('Tags saved.'));
  }

  protected copy(): void {
    this.run(() => this.api.copyObject(this.id, this.copyTarget), () =>
      this.message.set(`Copied to ${this.copyTarget}. Find the copy in Files.`));
  }

  private done(text: string): void {
    this.message.set(text);
    this.reload();
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
