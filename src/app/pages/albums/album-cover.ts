import { Component, inject, input, OnInit, signal } from '@angular/core';
import { DepotApi } from '../../core/api/depot-api.service';

/** An album's cover picture (its thumbnail), or a plain icon when there is none. */
@Component({
  selector: 'app-album-cover',
  template: `
    @if (url(); as u) {
      <img [src]="u" alt="" loading="lazy" (error)="url.set(null)" />
    } @else {
      <span aria-hidden="true">🗂</span>
    }
  `,
  styles: [`
    :host { position: absolute; inset: 0; display: grid; place-items: center; font-size: 3rem; }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
  `],
})
export class AlbumCover implements OnInit {
  private readonly api = inject(DepotApi);
  readonly objectId = input<string | null | undefined>(null);
  protected readonly url = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.objectId();
    if (id) {
      this.api.thumbnail(id).subscribe({ next: (t) => this.url.set(t.url), error: () => undefined });
    }
  }
}
