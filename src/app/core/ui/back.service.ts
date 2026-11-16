import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Remembers the previous page inside the app, so detail pages can offer a real Back (to the album,
 * the folder filter or the viewer they came from) instead of relying on the browser's button. With
 * no previous page (opened from a link or a refresh), Back goes to a sensible parent instead.
 */
@Injectable({ providedIn: 'root' })
export class BackService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private previous: string | null = null;
  private current: string | null = null;

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      // Only the query changing (the viewer's ?view=) is the same page, not a step back.
      const path = (u: string | null): string | null => u?.split('?')[0] ?? null;
      if (path(e.urlAfterRedirects) !== path(this.current)) {
        this.previous = this.current;
      }
      this.current = e.urlAfterRedirects;
    });
  }

  /** "Back to Braai 14"-style label: where Back goes. */
  label(fallbackLabel: string, names: { album?: string | null } = {}): string {
    const p = this.previous?.split('?')[0] ?? '';
    if (p.startsWith('/app/albums/')) {
      return names.album ? `Back to ${names.album}` : 'Back to album';
    }
    if (p === '/app/albums') {
      return 'Back to Albums';
    }
    if (p === '/app/files') {
      return 'Back to Files';
    }
    return this.previous ? 'Back' : fallbackLabel;
  }

  /** The album id when the previous page was an album page. */
  previousAlbumId(): string | null {
    const m = /^\/app\/albums\/([^/?]+)/.exec(this.previous ?? '');
    return m ? m[1] : null;
  }

  /** Goes back inside the app, or to `fallback` when this page was opened directly. */
  back(fallback: string): void {
    if (this.previous) {
      this.location.back();
    } else {
      void this.router.navigateByUrl(fallback);
    }
  }
}
