import { Component, ElementRef, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DepotApi } from '../../core/api/depot-api.service';
import type { SearchHit } from '../../core/api/models';
import { formatBytes } from '../../core/ui/format';

const PHOTO = /\.(jpe?g|png|gif|bmp)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|lrf)$/i;

/** Only a few previews are requested at once, so a long list does not flood the service. */
let inFlight = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < 4) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => { inFlight++; resolve(); }));
}

function release(): void {
  inFlight--;
  waiting.shift()?.();
}

/** One file in the gallery: a preview picture for photos, a simple tile for everything else. */
@Component({
  selector: 'app-file-tile',
  imports: [RouterLink],
  template: `
    <a class="tile" [routerLink]="['/app/files', hit().objectId]" [attr.aria-label]="hit().filename">
      <div class="pic">
        @if (url(); as u) {
          <img [src]="u" [alt]="hit().filename" loading="lazy" (error)="url.set(null)" />
        } @else {
          <span class="kind" aria-hidden="true">{{ icon() }}</span>
        }
      </div>
      <div class="cap">
        <span class="name">{{ hit().filename }}</span>
        <span class="size">{{ bytes(hit().size) }}</span>
      </div>
    </a>
  `,
  styles: [`
    :host { display: block; }
    .tile { display: block; text-decoration: none; color: inherit; border-radius: 12px; overflow: hidden;
      background: var(--ion-color-light); border: 1px solid var(--ion-color-light-shade); }
    .pic { aspect-ratio: 1; display: grid; place-items: center; background: var(--ion-color-light-shade); overflow: hidden; }
    .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .kind { font-size: 2.5rem; }
    .cap { padding: 0.4rem 0.6rem; display: grid; }
    .name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .size { font-size: 0.75rem; color: var(--ion-color-medium); }
  `],
})
export class FileTile implements OnInit, OnDestroy {
  private readonly api = inject(DepotApi);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly hit = input.required<SearchHit>();
  protected readonly url = signal<string | null>(null);
  protected readonly bytes = formatBytes;
  private observer?: IntersectionObserver;

  ngOnInit(): void {
    if (!PHOTO.test(this.hit().filename)) {
      return;
    }
    // Ask for the preview only when the tile scrolls into view.
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        this.observer?.disconnect();
        void this.load();
      }
    }, { rootMargin: '200px' });
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected icon(): string {
    const name = this.hit().filename;
    if (VIDEO.test(name)) {
      return '🎬';
    }
    return PHOTO.test(name) ? '🖼️' : '📄';
  }

  private async load(): Promise<void> {
    await acquire();
    this.api.thumbnail(this.hit().objectId).subscribe({
      next: (t) => { this.url.set(t.url); release(); },
      error: () => release(),     // no preview for this file: keep the simple tile
    });
  }
}
