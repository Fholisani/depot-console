import {
  Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, input, model, output, signal, untracked,
  viewChild,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBytes } from './format';
import { type MediaKind, kindIcon } from './media';

/** One file the viewer can show. */
export interface ViewerItem {
  id: string;
  filename: string;
  kind: MediaKind;
  size: number;
}

/** What to put on screen for an item: a URL for img, video or audio, or none (offer Download). */
export interface ViewerSource {
  kind: MediaKind;
  url: string | null;
}

/** Where the viewer gets an item's picture or stream; owners and visitors use different URLs. */
export type ViewerSourceFn = (item: ViewerItem) => Promise<ViewerSource>;

/**
 * Full-screen viewer over a list of files (Requirement 22.27): previous and next with the arrow keys,
 * the buttons or a swipe; Escape closes. It asks the host for more when the user nears the end of the
 * loaded list, and preloads the neighbouring pictures so swiping is quick on a phone.
 */
@Component({
  selector: 'app-media-viewer',
  imports: [RouterLink],
  template: `
    <div class="overlay" role="dialog" aria-modal="true" [attr.aria-label]="current()?.filename ?? 'Viewer'"
      #overlay tabindex="-1">
      <header class="bar">
        <div class="title">
          <span class="name">{{ current()?.filename }}</span>
          <span class="meta">{{ index() + 1 }} of {{ items().length }}{{ hasMore() ? '+' : '' }}
            @if (current(); as c) { · {{ bytes(c.size) }} }</span>
        </div>
        <div class="actions">
          @if (current(); as c) {
            @if (downloadUrl()(c); as href) {
              <a class="btn" [href]="href" download>Download</a>
            }
            @if (detailsLink()(c); as link) {
              <a class="btn" [routerLink]="link">Details</a>
            }
          }
          <button type="button" class="btn close" (click)="close.emit()" aria-label="Close viewer">✕</button>
        </div>
      </header>
      <div class="stage" (touchstart)="touchStart($event)" (touchend)="touchEnd($event)"
        (click)="backdropClick($event)">
        @if (index() > 0) {
          <button type="button" class="nav prev" (click)="go(-1)" aria-label="Previous">‹</button>
        }
        @if (source(); as s) {
          @if (s.url && !failed()) {
            @switch (s.kind) {
              @case ('image') {
                <img [src]="s.url" [alt]="current()?.filename" (error)="onError()" />
              }
              @case ('video') {
                <video [src]="s.url" controls playsinline autoplay preload="metadata" (error)="onError()"></video>
              }
              @case ('audio') {
                <div class="audio">
                  <span class="icon" aria-hidden="true">🎵</span>
                  <audio [src]="s.url" controls autoplay (error)="onError()"></audio>
                </div>
              }
              @case ('pdf') {
                <div class="none">
                  <span class="icon" aria-hidden="true">📕</span>
                  <a class="btn" [href]="s.url" target="_blank" rel="noopener">Open PDF</a>
                </div>
              }
              @default {
                <div class="none"><span class="icon" aria-hidden="true">📄</span></div>
              }
            }
          } @else {
            <div class="none">
              <span class="icon" aria-hidden="true">{{ icon() }}</span>
              <p>{{ failed() ? "This browser can't show this file here." : 'No preview for this file.' }}
                Download it to open it on your device.</p>
            </div>
          }
        } @else {
          <div class="none"><span class="spinner" aria-label="Loading"></span></div>
        }
        @if (index() < items().length - 1) {
          <button type="button" class="nav next" (click)="go(1)" aria-label="Next">›</button>
        }
      </div>
    </div>
  `,
  styles: [`
    .overlay { position: fixed; inset: 0; z-index: 2000; background: #000; color: #fff; display: grid;
      grid-template-rows: auto 1fr; outline: none; }
    .bar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;
      padding: calc(0.5rem + env(safe-area-inset-top, 0px)) calc(0.75rem + env(safe-area-inset-right, 0px))
        0.5rem calc(0.75rem + env(safe-area-inset-left, 0px));
      background: rgba(0,0,0,0.6); position: relative; z-index: 2; }
    .title { display: grid; min-width: 0; }
    .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 0.8rem; color: #bbb; }
    .actions { display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0; }
    .btn { color: #fff; background: rgba(255,255,255,0.12); border: 0; border-radius: 8px; padding: 0.4rem 0.7rem;
      text-decoration: none; font-size: 0.9rem; cursor: pointer; }
    .close { font-size: 1.3rem; min-width: 2.75rem; min-height: 2.75rem; }
    .stage { position: relative; display: grid; place-items: center; overflow: hidden; touch-action: pan-y; }
    .stage img, .stage video { max-width: 100vw; max-height: calc(100dvh - 4.5rem - env(safe-area-inset-top, 0px));
      object-fit: contain; display: block; }
    .overlay { height: 100dvh; }
    .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 3rem; height: 3rem; border-radius: 50%;
      border: 0; background: rgba(255,255,255,0.15); color: #fff; font-size: 2rem; line-height: 1; cursor: pointer; z-index: 1; }
    .prev { left: 0.5rem; }
    .next { right: 0.5rem; }
    .none, .audio { display: grid; justify-items: center; gap: 0.75rem; text-align: center; padding: 1rem; }
    .icon { font-size: 4rem; }
    .spinner { width: 2rem; height: 2rem; border: 3px solid #555; border-top-color: #fff; border-radius: 50%;
      animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (hover: none) { .nav { background: rgba(255,255,255,0.08); } }
  `],
})
export class MediaViewer implements OnInit, OnDestroy {
  readonly items = input.required<ViewerItem[]>();
  readonly index = model.required<number>();
  readonly sourceFor = input.required<ViewerSourceFn>();
  readonly hasMore = input(false);
  /** A URL that downloads the item, or null when the host has none (owners use the file page). */
  readonly downloadUrl = input<(item: ViewerItem) => string | null>(() => null);
  /** A router link to the item's page, or null. */
  readonly detailsLink = input<(item: ViewerItem) => unknown[] | null>(() => null);

  readonly close = output<void>();
  /** Emitted near the end of the loaded list while the host has more. */
  readonly more = output<void>();

  private readonly overlay = viewChild<ElementRef<HTMLElement>>('overlay');
  protected readonly current = computed(() => this.items()[this.index()] ?? null);
  protected readonly source = signal<ViewerSource | null>(null);
  protected readonly failed = signal(false);
  protected readonly bytes = formatBytes;
  private readonly cache = new Map<string, Promise<ViewerSource>>();
  private readonly retried = new Set<string>();
  private touchX: number | null = null;
  private touchY: number | null = null;
  private readonly host = inject(ElementRef<HTMLElement>);
  private previousOverflow = '';

  /** Changes only when another file is shown, not when more of the list loads. */
  private readonly currentId = computed(() => this.current()?.id ?? null);

  constructor() {
    effect(() => {
      this.currentId();
      untracked(() => this.show());
    });
  }

  private show(): void {
    const item = this.current();
    this.failed.set(false);
    this.source.set(null);
    if (!item) {
      return;
    }
    void this.load(item).then((s) => {
      if (this.current()?.id === item.id) {
        this.source.set(s);
      }
    });
    this.preload(this.index());
    if (this.hasMore() && this.index() >= this.items().length - 3) {
      this.more.emit();
    }
  }

  ngOnInit(): void {
    // Render on top of the whole page, not inside the scrolling content: inside Ionic's content the
    // fixed overlay was placed relative to the scrolled list, so its top bar (and the ✕) could sit
    // above the screen on a phone.
    document.body.appendChild(this.host.nativeElement);
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => this.overlay()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.previousOverflow;
    this.host.nativeElement.remove();
  }

  /** A tap on the empty area around the picture or video closes the viewer. */
  protected backdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      this.close.emit();
    }
  }

  protected icon(): string {
    return kindIcon(this.current()?.kind ?? 'other');
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') {
      this.go(1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      this.go(-1);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.close.emit();
    }
  }

  protected go(step: number): void {
    const next = this.index() + step;
    if (next >= 0 && next < this.items().length) {
      this.index.set(next);
    }
  }

  protected touchStart(e: TouchEvent): void {
    this.touchX = e.changedTouches[0]?.clientX ?? null;
    this.touchY = e.changedTouches[0]?.clientY ?? null;
  }

  /** Swipe left or right for the next or previous file; swipe down to close. */
  protected touchEnd(e: TouchEvent): void {
    const startX = this.touchX;
    const startY = this.touchY;
    this.touchX = null;
    this.touchY = null;
    const endX = e.changedTouches[0]?.clientX;
    const endY = e.changedTouches[0]?.clientY;
    if (startX === null || startY === null || endX === undefined || endY === undefined) {
      return;
    }
    const dx = endX - startX;
    const dy = endY - startY;
    if (dy > 80 && dy > Math.abs(dx) * 1.5) {
      this.close.emit();
    } else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      this.go(dx < 0 ? 1 : -1);
    }
  }

  /** A picture that failed may have an expired link: try a fresh one once, then give up. */
  protected onError(): void {
    const item = this.current();
    if (!item || this.retried.has(item.id)) {
      this.failed.set(true);
      return;
    }
    this.retried.add(item.id);
    this.cache.delete(item.id);
    this.source.set(null);
    void this.load(item).then((s) => {
      if (this.current()?.id === item.id) {
        if (s.url) {
          this.source.set(s);
        } else {
          this.failed.set(true);
        }
      }
    });
  }

  private load(item: ViewerItem): Promise<ViewerSource> {
    let p = this.cache.get(item.id);
    if (!p) {
      p = this.sourceFor()(item).catch(() => ({ kind: item.kind, url: null }));
      this.cache.set(item.id, p);
    }
    return p;
  }

  /** Fetches the neighbours' sources and warms the browser cache for their pictures. */
  private preload(index: number): void {
    for (const i of [index + 1, index - 1]) {
      const item = this.items()[i];
      if (item && item.kind === 'image') {
        void this.load(item).then((s) => {
          if (s.url && s.kind === 'image') {
            const img = new Image();
            img.src = s.url;
          }
        });
      }
    }
  }
}
