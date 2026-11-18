import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSpinner, IonText, ViewWillEnter,
} from '@ionic/angular';
import { ApiError } from '../../core/api/api-error';
import { DepotApi } from '../../core/api/depot-api.service';
import type { ListedFile, UsageReport } from '../../core/api/models';
import { SessionService } from '../../core/tenant/session.service';
import { describeError, formatBytes } from '../../core/ui/format';

/** Rough sizes for "what still fits": a phone photo, and one minute of 4K phone video (~50 Mbit/s). */
const PHOTO_BYTES = 4 * 1024 * 1024;
const VIDEO_MINUTE_BYTES = 375 * 1024 * 1024;

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Signed-in home: how full the account is in human terms, recent files, and this month's downloads. */
@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe, RouterLink, IonButton, IonItem, IonLabel, IonList, IonNote, IonProgressBar, IonSpinner, IonText,
  ],
  template: `
    <h1 class="hello">Your space</h1>

    @if (usageProblem()) {
      <ion-text color="danger"><p role="alert">{{ usageProblem() }}</p></ion-text>
    } @else if (usage(); as u) {
      <section class="card space">
        <svg class="ring" viewBox="0 0 120 120" role="img"
          [attr.aria-label]="percentUsed() + ' percent of your space is used'">
          <circle cx="60" cy="60" [attr.r]="ringRadius" class="track" />
          <circle cx="60" cy="60" [attr.r]="ringRadius" class="fill" [class.warn]="share() > 0.9"
            [attr.stroke-dasharray]="ringLength" [attr.stroke-dashoffset]="ringOffset()" />
          <text x="60" y="58" text-anchor="middle" class="pct">{{ percentUsed() }}%</text>
          <text x="60" y="76" text-anchor="middle" class="pct-label">used</text>
        </svg>
        <div class="space-text">
          <p class="big"><strong>{{ bytes(used()) }}</strong> of {{ bytes(u.storage.limitBytes) }}</p>
          <p class="muted">
            {{ u.storage.objectCount }} {{ u.storage.objectCount === 1 ? 'file' : 'files' }} kept safe ·
            {{ bytes(free()) }} free
          </p>
          @if (free() > 0) {
            <p class="fits">
              Room for about <strong>{{ photosLeft() }}</strong> more photos
              or <strong>{{ videoLeft() }}</strong> of 4K video.
            </p>
          } @else {
            <p class="fits warn-text">Your space is full. Delete files you no longer need, or move to a bigger plan.</p>
          }
          @if (u.storage.reservedBytes > 0) {
            <ion-note>{{ bytes(u.storage.reservedBytes) }} is being uploaded right now.</ion-note>
          }
          <ion-button routerLink="/app/files" class="cta">Upload files</ion-button>
          <a routerLink="/pricing" class="small">Need more space?</a>
        </div>
      </section>

      @if (trend(); as t) {
        <section class="card">
          <h2>Last 30 days</h2>
          <svg class="trend" viewBox="0 0 300 60" preserveAspectRatio="none" role="img"
            aria-label="Space used over the last 30 days">
            <polyline [attr.points]="t" class="trend-line" />
          </svg>
        </section>
      }

      <section class="card">
        <div class="row-head">
          <h2>Recent files</h2>
          <a routerLink="/app/files">See all</a>
        </div>
        @if (recent() === null) {
          <ion-spinner name="crescent" aria-label="Loading recent files" />
        } @else if (recent()!.length === 0) {
          <p class="muted">Nothing here yet. Your first upload will show up here.</p>
        } @else {
          <ion-list lines="none">
            @for (f of recent(); track f.objectId) {
              <ion-item [routerLink]="['/app/files', f.objectId]" detail>
                <span class="kind" slot="start" aria-hidden="true">{{ icon(f.contentType) }}</span>
                <ion-label>
                  <h3>{{ f.filename }}</h3>
                  <p>{{ bytes(f.size) }} · {{ f.createdAt | date: 'mediumDate' }}</p>
                </ion-label>
              </ion-item>
            }
          </ion-list>
        }
      </section>

      <section class="card month">
        <h2>Downloads this month</h2>
        @if (u.month.egressLimitBytes) {
          <ion-progress-bar [value]="egressShare()" [color]="egressShare() > 0.9 ? 'danger' : 'primary'"
            aria-label="Downloads used this month" />
          <p class="muted">
            {{ bytes(u.month.egressBytes) }} of {{ bytes(u.month.egressLimitBytes) }} · resets on the 1st
          </p>
        } @else {
          <p class="muted">{{ bytes(u.month.egressBytes) }} downloaded</p>
        }
      </section>
    } @else {
      <ion-spinner name="crescent" aria-label="Loading" />
    }
  `,
  styles: [`
    .hello { margin: 0.5rem 0 1rem; }
    .card { margin-bottom: 1.25rem; }
    .card h2 { font-size: 1.05rem; margin: 0 0 0.75rem; }
    .space { display: grid; grid-template-columns: 9rem 1fr; gap: 1.75rem; align-items: center; }
    .ring { width: 9rem; height: 9rem; }
    .track { fill: none; stroke: var(--depot-accent-soft); stroke-width: 12; }
    .fill { fill: none; stroke: var(--ion-color-primary); stroke-width: 12; stroke-linecap: round;
      transform: rotate(-90deg); transform-origin: 60px 60px; transition: stroke-dashoffset 0.6s ease; }
    .fill.warn { stroke: var(--ion-color-danger); }
    .pct { font-size: 22px; font-weight: 700; fill: var(--depot-text); }
    .pct-label { font-size: 11px; fill: var(--depot-muted); }
    .space-text p { margin: 0 0 0.35rem; }
    .big { font-size: 1.5rem; }
    .fits { margin-top: 0.6rem !important; }
    .warn-text { color: var(--ion-color-danger); }
    .cta { margin: 0.9rem 0.75rem 0 0; }
    .small { font-size: 0.9rem; }
    .row-head { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: 1.4rem; margin-right: 0.25rem; }
    .trend { width: 100%; height: 60px; }
    .trend-line { fill: none; stroke: var(--ion-color-primary); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .month ion-progress-bar { margin-bottom: 0.4rem; }
    @media (max-width: 34rem) { .space { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
  `],
})
export class DashboardPage implements OnInit, ViewWillEnter {
  private readonly api = inject(DepotApi);
  protected readonly session = inject(SessionService);

  protected readonly usage = signal<UsageReport | null>(null);
  protected readonly usageProblem = signal<string | null>(null);
  protected readonly recent = signal<ListedFile[] | null>(null);
  protected readonly bytes = formatBytes;
  protected readonly ringRadius = RING_RADIUS;
  protected readonly ringLength = RING_LENGTH;

  protected readonly used = computed(() => {
    const s = this.usage()?.storage;
    return s ? s.storedBytes + s.reservedBytes : 0;
  });
  protected readonly free = computed(() => Math.max(0, (this.usage()?.storage.limitBytes ?? 0) - this.used()));
  protected readonly share = computed(() => {
    const limit = this.usage()?.storage.limitBytes ?? 0;
    return limit > 0 ? Math.min(1, this.used() / limit) : 0;
  });
  /** Whole percent, but never shows 0% once something is stored. */
  protected readonly percentUsed = computed(() => {
    const p = this.share() * 100;
    return p > 0 && p < 1 ? '<1' : String(Math.round(p));
  });
  protected readonly ringOffset = computed(() => RING_LENGTH * (1 - this.share()));
  protected readonly photosLeft = computed(() =>
    Math.floor(this.free() / PHOTO_BYTES).toLocaleString());
  protected readonly videoLeft = computed(() => {
    const minutes = Math.floor(this.free() / VIDEO_MINUTE_BYTES);
    return minutes >= 120 ? `${Math.floor(minutes / 60)} hours` : `${minutes} minutes`;
  });
  protected readonly egressShare = computed(() => {
    const m = this.usage()?.month;
    return m?.egressLimitBytes ? Math.min(1, m.egressBytes / m.egressLimitBytes) : 0;
  });
  /** SVG points for stored bytes over the last 30 days; null until there are two days of history. */
  protected readonly trend = computed(() => {
    const days = this.usage()?.daily ?? [];
    if (days.length < 2) {
      return null;
    }
    const max = Math.max(...days.map((d) => d.storedBytes), 1);
    return days.map((d, i) =>
      `${((i / (days.length - 1)) * 300).toFixed(1)},${(58 - (d.storedBytes / max) * 54).toFixed(1)}`).join(' ');
  });

  ngOnInit(): void {
    this.refresh();
  }

  /**
   * Ionic keeps a visited tab alive, so ngOnInit runs only the first time: after uploading, coming back
   * to the dashboard showed the old space used. Load again every time the dashboard is shown.
   */
  ionViewWillEnter(): void {
    if (this.usage() !== null || this.usageProblem() !== null) {
      this.refresh();
    }
  }

  private refresh(): void {
    this.api.usage().subscribe({
      next: (u) => {
        this.usage.set(u);
        this.usageProblem.set(null);
      },
      error: (e: ApiError) => this.usageProblem.set(describeError(e)),
    });
    // From the database list, so recent files show even while search is unavailable.
    this.api.files({ size: 5 }).subscribe({
      next: (r) => this.recent.set(r.items),
      error: () => this.recent.set([]),
    });
  }

  protected icon(contentType: string | null | undefined): string {
    const t = contentType ?? '';
    if (t.startsWith('image/')) {
      return '\u{1F5BC}';
    }
    if (t.startsWith('video/')) {
      return '\u{1F3AC}';
    }
    if (t === 'application/pdf' || t.startsWith('text/') || t.includes('document')) {
      return '\u{1F4C4}';
    }
    return '\u{1F4E6}';
  }
}
