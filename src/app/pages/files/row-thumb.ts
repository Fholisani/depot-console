import { Component, ElementRef, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { DepotApi } from '../../core/api/depot-api.service';
import { hasPicture, kindIcon, kindOf } from '../../core/ui/media';
import { loadThumbnail, whenVisible } from '../../core/ui/thumbnail-loader';

/** A small square picture for a list row: the 480 px thumbnail, never the original. */
@Component({
  selector: 'app-row-thumb',
  template: `
    @if (url(); as u) {
      <img [src]="u" alt="" loading="lazy" (error)="url.set(null)" />
    } @else {
      <span aria-hidden="true">{{ icon() }}</span>
    }
  `,
  styles: [`
    :host { width: 3rem; height: 3rem; flex: none; border-radius: 8px; overflow: hidden; display: grid;
      place-items: center; background: var(--ion-color-light-shade); font-size: 1.4rem; margin-right: 0.75rem; }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
  `],
})
export class RowThumb implements OnInit, OnDestroy {
  private readonly api = inject(DepotApi);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly objectId = input.required<string>();
  readonly filename = input.required<string>();
  readonly contentType = input<string | null | undefined>(null);
  protected readonly url = signal<string | null>(null);
  private stopWatching?: () => void;
  private destroyed = false;

  protected icon(): string {
    return kindIcon(kindOf(this.filename(), this.contentType()));
  }

  ngOnInit(): void {
    if (!hasPicture(this.filename(), this.contentType())) {
      return;
    }
    this.stopWatching = whenVisible(this.el.nativeElement, () => {
      void loadThumbnail(this.api, this.objectId(), () => !this.destroyed).then((u) => u && this.url.set(u));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopWatching?.();
  }
}
