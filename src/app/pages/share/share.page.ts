import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';
import { DepotApi } from '../../core/api/depot-api.service';
import type { SharedFile } from '../../core/api/models';
import { formatBytes } from '../../core/ui/format';
import { currentEnvironment } from '../../core/slot/slot.service';

const KIND_LABEL: Record<string, string> = {
  image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'Document', other: 'File',
};

/** What a visitor sees when they open a share link: no account needed. */
@Component({
  selector: 'app-share',
  imports: [DatePipe, IonButton, IonSpinner, RouterLink],
  template: `
    <section class="container share">
      @if (env !== 'active') {
        <p class="envnote">{{ env === 'dev' ? 'Test mode on this computer' : 'Test version' }}</p>
      }
      @if (file(); as f) {
        @if (!cannotShow()) {
          @switch (f.kind) {
            @case ('image') {
              <div class="viewer"><img [src]="src()" [alt]="f.filename" (error)="cannotShow.set(true)" /></div>
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
          <p class="muted">This browser can't show the {{ label(f).toLowerCase() }} here. Download it to open it on your device.</p>
        }

        <h1>{{ f.filename }}</h1>
        @if (f.description) { <p class="desc">{{ f.description }}</p> }
        <p class="meta">
          {{ label(f) }} · {{ bytes(f.size) }}
          @if (f.sharedBy) { · Shared by {{ f.sharedBy }} }
          · {{ f.sharedAt | date: 'd MMM y' }}
        </p>
        @if (f.expiresAt) {
          <p class="muted">This link works until {{ f.expiresAt | date: 'd MMM y, HH:mm' }}.</p>
        }
        <ion-button [href]="downloadUrl()" size="large">Download ({{ bytes(f.size) }})</ion-button>
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
  `,
  styles: [`
    .share { max-width: 46rem; padding: 2.5rem 1.25rem 4rem; text-align: center; }
    .viewer { background: #000; border-radius: 14px; overflow: hidden; margin-bottom: 1.25rem; }
    .viewer img, .viewer video { max-width: 100%; max-height: 65vh; display: block; margin: 0 auto; }
    .viewer audio { width: 100%; background: #fff; display: block; }
    h1 { font-size: 1.6rem; margin: 0.5rem 0; word-break: break-word; }
    .desc { font-size: 1.05rem; white-space: pre-wrap; }
    .meta { color: var(--ion-color-medium); }
    .foot { margin-top: 2rem; font-size: 0.9rem; }
    .envnote { background: #fff4d6; color: #7a5a00; border-radius: 8px; padding: 0.3rem 0.6rem; display: inline-block; font-size: 0.85rem; }
  `],
})
export class SharePage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly file = signal<SharedFile | null>(null);
  protected readonly gone = signal(false);
  protected readonly cannotShow = signal(false);
  protected readonly bytes = formatBytes;
  protected readonly env = currentEnvironment();

  ngOnInit(): void {
    this.api.sharedFile(this.token).subscribe({
      next: (f) => this.file.set(f),
      error: () => this.gone.set(true),
    });
  }

  protected src(): string {
    return this.api.sharedContentUrl(this.token);
  }

  protected downloadUrl(): string {
    return this.api.sharedContentUrl(this.token, true);
  }

  protected label(f: SharedFile): string {
    return KIND_LABEL[f.kind] ?? 'File';
  }
}
