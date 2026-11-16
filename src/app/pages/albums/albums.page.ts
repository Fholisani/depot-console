import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { IonButton, IonSpinner, IonText } from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { Album } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { AlbumDialogs } from '../../core/ui/album-dialogs.service';
import { describeError, formatBytes } from '../../core/ui/format';
import { AlbumCover } from './album-cover';

/** The tenant's albums as cards with a cover; "New album" makes an empty one. */
@Component({
  selector: 'app-albums',
  imports: [AlbumCover, RouterLink, IonButton, IonSpinner, IonText],
  template: `
    <h1>Albums</h1>
    <p class="muted">
      An album collects photos, videos and documents from any folder. A file can be in several albums,
      and removing it from an album does not delete it. Share an album to send everyone one link.
    </p>
    @if (session.canWrite()) {
      <div class="actions">
        <ion-button (click)="create()" [disabled]="busy()">New album</ion-button>
        <ion-button fill="outline" routerLink="/app/files">Select files on the Files page</ion-button>
      </div>
    }
    @if (problem()) { <ion-text color="danger"><p role="alert">{{ problem() }}</p></ion-text> }
    @if (loading()) {
      <ion-spinner name="crescent" aria-label="Loading albums" />
    } @else if (albums().length === 0) {
      <p>No albums yet. On the Files page, press Select, tick some files and choose "Add to new album".</p>
    } @else {
      <div class="grid">
        @for (a of albums(); track a.id) {
          <a class="card" [routerLink]="['/app/albums', a.id]">
            <div class="cover">
              <app-album-cover [objectId]="a.coverObjectId" />
              @if (a.shared) { <span class="shared">🔗 Shared</span> }
            </div>
            <div class="cap">
              <strong>{{ a.name }}</strong>
              <span>{{ a.itemCount }} {{ a.itemCount === 1 ? 'item' : 'items' }} · {{ bytes(a.totalSize) }}</span>
            </div>
          </a>
        }
      </div>
    }
  `,
  styles: [`
    .muted { color: var(--ion-color-medium); }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.5rem 0 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.9rem; }
    .card { display: block; text-decoration: none; color: inherit; border-radius: 14px; overflow: hidden;
      border: 1px solid var(--ion-color-light-shade); background: var(--ion-color-light); }
    .cover { position: relative; aspect-ratio: 1; display: grid; place-items: center; background: var(--ion-color-light-shade); }
    .shared { position: absolute; top: 0.5rem; right: 0.5rem; background: rgba(0,0,0,0.6); color: #fff;
      font-size: 0.75rem; border-radius: 999px; padding: 0.15rem 0.5rem; }
    .cap { display: grid; padding: 0.5rem 0.7rem; gap: 0.1rem; }
    .cap span { font-size: 0.8rem; color: var(--ion-color-medium); }
  `],
})
export class AlbumsPage implements OnInit {
  private readonly api = inject(DepotApi);
  private readonly router = inject(Router);
  private readonly dialogs = inject(AlbumDialogs);
  protected readonly session = inject(SessionService);
  protected readonly albums = signal<Album[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly bytes = formatBytes;

  ngOnInit(): void {
    this.api.albums().subscribe({
      next: (a) => {
        this.albums.set(a);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.problem.set(describeError(e));
        this.loading.set(false);
      },
    });
  }

  protected async create(): Promise<void> {
    const answer = await this.dialogs.newAlbum();
    if (!answer) {
      return;
    }
    this.busy.set(true);
    try {
      const album = await firstValueFrom(this.api.createAlbum({ ...answer, objectIds: [] }));
      await this.router.navigate(['/app/albums', album.id]);
    } catch (e) {
      this.problem.set(describeError(ApiError.from(e)));
    } finally {
      this.busy.set(false);
    }
  }
}
