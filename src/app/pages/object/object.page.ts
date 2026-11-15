import { DatePipe } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Observable } from 'rxjs';
import {
  IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput, IonItem,
  IonLabel, IonList, IonNote, IonProgressBar, IonSelect, IonSelectOption, IonSpinner, IonText,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { DepotObject, Namespace, Progress, Version } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError, formatBytes } from '../../core/ui/format';

interface TagRow {
  key: string;
  value: string;
}

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
          <ion-note aria-live="polite">{{ downloadText(d) }}</ion-note>
        </div>
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
      </div>

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
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .dl { display: grid; gap: 0.25rem; margin: 0.75rem 0; font-size: 0.85rem; }
    .tag { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.5rem; align-items: center; }
    .wrap { word-break: break-all; }
    .tagbadge { margin-right: 0.35rem; }
  `],
})
export class ObjectPage implements OnInit, OnDestroy {
  private readonly api = inject(DepotApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionService);

  protected readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly object = signal<DepotObject | null>(null);
  protected readonly versions = signal<Version[]>([]);
  protected readonly tagRows = signal<TagRow[]>([]);
  protected readonly namespaces = signal<Namespace[]>([]);
  protected readonly progress = signal<Progress | null>(null);
  protected readonly downloading = signal<{ name: string; loaded: number; total: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly bytes = formatBytes;
  protected copyTarget = '';

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
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e, PROBLEMS));
        this.loading.set(false);
      },
    });
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

  /** Downloads with a progress bar, then hands the file to the browser to save. */
  protected download(version?: Version): void {
    const name = version?.filename ?? this.object()?.latest?.filename ?? 'download';
    const expected = version?.size ?? this.object()?.latest?.size ?? 0;
    this.busy.set(true);
    this.problem.set(null);
    this.message.set(null);
    this.downloading.set({ name, loaded: 0, total: expected });
    this.api.download(this.id, version?.versionId).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.DownloadProgress) {
          this.downloading.set({ name, loaded: event.loaded, total: event.total ?? expected });
        } else if (event.type === HttpEventType.Response && event.body) {
          this.save(event.body, name);
          this.downloading.set(null);
          this.busy.set(false);
          this.message.set(`${name} downloaded.`);
        }
      },
      error: (e: ApiError) => {
        this.downloading.set(null);
        this.busy.set(false);
        this.problem.set(describeError(e, PROBLEMS));
      },
    });
  }

  /** "Downloading 42% · 20 MB of 48 MB", or just the bytes when the size is unknown. */
  protected downloadText(d: { loaded: number; total: number }): string {
    if (d.total > 0) {
      const pct = Math.min(100, Math.floor((d.loaded / d.total) * 100));
      return `Downloading ${pct}% · ${this.bytes(d.loaded)} of ${this.bytes(d.total)}`;
    }
    return `Downloading · ${this.bytes(d.loaded)}`;
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

  protected remove(): void {
    if (!confirm('Delete this file? You can undelete it until its versions are purged.')) {
      return;
    }
    this.run(() => this.api.deleteObject(this.id), () => this.done('File deleted.'));
  }

  protected undelete(): void {
    this.run(() => this.api.undeleteObject(this.id), () => this.done('File restored.'));
  }

  protected restore(v: Version): void {
    this.run(() => this.api.restoreVersion(this.id, v.versionId), () => this.done(`Version ${v.versionNo} restored as the current version.`));
  }

  protected purge(v: Version): void {
    if (!confirm(`Permanently delete version ${v.versionNo}? This cannot be undone.`)) {
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
