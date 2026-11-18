import { Component, ElementRef, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { DepotApi } from '../../core/api/depot-api.service';
import { formatBytes } from '../../core/ui/format';
import { formatDuration, formatRecorded, hasThumbnail, isNumericName, kindIcon, kindOf } from '../../core/ui/media';
import { loadThumbnail, whenVisible } from '../../core/ui/thumbnail-loader';

/** What a tile needs to know about a file. */
export interface TileFile {
  objectId: string;
  filename: string;
  size: number;
  contentType?: string | null;
  /** A video whose poster exists (file list). */
  poster?: boolean;
  /** The API has a picture of it (album and shared items). */
  thumbnail?: boolean;
  durationMs?: number | null;
  recordedAt?: string | null;
}

/** Album marks on a tile: in an album, or in a shared album. */
export type TileMark = 'album' | 'shared' | null;

/**
 * One file in a gallery: a preview picture for photos and videos with a poster (videos also show their
 * length), a simple tile for everything else. Clicking
 * opens it (the host shows the viewer) or, in select mode, ticks it. Signed-in pages get the picture
 * from the API; the shared-album page passes a public `pictureUrl` instead.
 */
@Component({
  selector: 'app-file-tile',
  template: `
    <button type="button" class="tile" [class.selected]="selected()" [class.selecting]="selecting()"
      (click)="activate.emit()" [attr.aria-label]="label()" [attr.aria-pressed]="selecting() ? selected() : null">
      <div class="pic">
        @if (url(); as u) {
          <img [src]="u" [alt]="file().filename" loading="lazy" (error)="url.set(null)" />
        } @else {
          <span class="kind" aria-hidden="true">{{ icon() }}</span>
        }
        @if (kind() === 'video') {
          <span class="play" aria-hidden="true">▶{{ duration() ? ' ' + duration() : '' }}</span>
        }
        @if (selecting()) {
          <span class="check" aria-hidden="true">{{ selected() ? '✓' : '' }}</span>
        }
        @if (mark(); as m) {
          <span class="mark" [class.shared]="m === 'shared'" [attr.title]="m === 'shared' ? 'In a shared album' : 'In an album'">
            {{ m === 'shared' ? '🔗' : '★' }}
          </span>
        }
      </div>
      <div class="cap">
        <span class="name" [attr.title]="file().filename">{{ name() }}</span>
        <span class="size">{{ details() }}</span>
      </div>
    </button>
  `,
  styles: [`
    :host { display: block; }
    .tile { display: block; width: 100%; padding: 0; text-align: left; font: inherit; cursor: pointer;
      color: inherit; border-radius: 12px; overflow: hidden;
      background: var(--ion-color-light); border: 1px solid var(--ion-color-light-shade); }
    .tile.selected { outline: 3px solid var(--ion-color-primary); outline-offset: -3px; }
    .pic { position: relative; aspect-ratio: 1; display: grid; place-items: center;
      background: var(--ion-color-light-shade); overflow: hidden; }
    .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .kind { font-size: 2.5rem; }
    .play { position: absolute; bottom: 0.4rem; left: 0.4rem; background: rgba(0,0,0,0.55); color: #fff;
      border-radius: 999px; font-size: 0.75rem; padding: 0.15rem 0.45rem; }
    .check { position: absolute; top: 0.4rem; left: 0.4rem; width: 1.5rem; height: 1.5rem; border-radius: 50%;
      border: 2px solid #fff; background: rgba(0,0,0,0.35); color: #fff; display: grid; place-items: center;
      font-size: 0.9rem; font-weight: 700; }
    .selected .check { background: var(--ion-color-primary); border-color: var(--ion-color-primary); }
    .mark { position: absolute; top: 0.4rem; right: 0.4rem; background: rgba(0,0,0,0.55); color: #ffd54f;
      border-radius: 999px; font-size: 0.8rem; padding: 0.1rem 0.4rem; }
    .mark.shared { color: #fff; }
    .cap { padding: 0.4rem 0.6rem; display: grid; }
    .name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .size { font-size: 0.75rem; color: var(--ion-color-medium); }
  `],
})
export class FileTile implements OnInit, OnDestroy {
  private readonly api = inject(DepotApi);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly file = input.required<TileFile>();
  /** A public picture URL (shared albums); when set, the API is not asked. */
  readonly pictureUrl = input<string | null>(null);
  readonly selecting = input(false);
  readonly selected = input(false);
  readonly mark = input<TileMark>(null);
  /** Clicked: open it, or tick it in select mode. */
  readonly activate = output<void>();

  protected readonly url = signal<string | null>(null);
  protected readonly bytes = formatBytes;
  private stopWatching?: () => void;
  private destroyed = false;

  protected kind() {
    return kindOf(this.file().filename, this.file().contentType);
  }

  protected icon(): string {
    return kindIcon(this.kind());
  }

  protected duration(): string {
    return formatDuration(this.file().durationMs);
  }

  /** The recording date instead of a name that is only digits (camera and phone video names). */
  protected name(): string {
    const f = this.file();
    const recorded = formatRecorded(f.recordedAt);
    return recorded && isNumericName(f.filename) ? recorded : f.filename;
  }

  protected details(): string {
    const f = this.file();
    const recorded = formatRecorded(f.recordedAt);
    const size = this.bytes(f.size);
    return recorded && this.name() !== recorded ? `${size} · ${recorded}` : size;
  }

  protected label(): string {
    const f = this.file();
    return this.selecting() ? `${this.selected() ? 'Unselect' : 'Select'} ${f.filename}` : `Open ${f.filename}`;
  }

  ngOnInit(): void {
    const given = this.pictureUrl();
    if (given) {
      this.url.set(given);
      return;
    }
    if (!hasThumbnail(this.file())) {
      return;
    }
    // Ask for the thumbnail only when the tile scrolls into view.
    this.stopWatching = whenVisible(this.el.nativeElement, () => {
      void loadThumbnail(this.api, this.file().objectId, () => !this.destroyed).then((u) => u && this.url.set(u));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopWatching?.();
  }
}
