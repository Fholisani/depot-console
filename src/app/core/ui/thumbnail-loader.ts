import { firstValueFrom } from 'rxjs';
import { ApiError } from '../api/api-error';
import type { DepotApi } from '../api/depot-api.service';

/**
 * Up to six pictures are asked for at once. Most already exist and are a quick read; the service makes
 * new ones two at a time itself and answers RATE_LIMITED when busy, which is retried below. (It was two
 * here, which made a screen of 30 existing thumbnails load in 15 rounds.)
 */
const MAX_IN_FLIGHT = 6;
/** Busy or briefly unreachable: ask again after 2 s, 4 s, 6 s … up to this many times. */
const RETRIES = 8;
const RETRYABLE = new Set<ApiError['reason']>(['RATE_LIMITED', 'STORAGE_UNAVAILABLE', 'NETWORK_ERROR']);
/** A remembered link is reused only while it has at least this long left. */
const MIN_LEFT_MS = 60_000;

let inFlight = 0;
const waiting: Array<() => void> = [];

/**
 * Links already handed out, by object. Reusing the same link lets the browser show the copy it kept
 * (the service allows 10 minutes), so going back to a folder does not download every picture again.
 */
const known = new Map<string, { url: string; until: number }>();
/** Lookups under way, so two tiles of the same file share one request; it goes on while any is shown. */
const pending = new Map<string, { lookup: Promise<string | null>; alive: Array<() => boolean> }>();

function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => { inFlight++; resolve(); }));
}

function release(): void {
  inFlight--;
  waiting.shift()?.();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A remembered link that is still good for a while, if any. */
export function knownThumbnail(objectId: string, now = Date.now()): string | null {
  const k = known.get(objectId);
  if (k && k.until - now > MIN_LEFT_MS) {
    return k.url;
  }
  known.delete(objectId);
  return null;
}

/** Forgets every remembered link (signing out, tests). */
export function forgetThumbnails(): void {
  known.clear();
  pending.clear();
}

/**
 * The URL of a file's 480 px thumbnail, or null when it has none. Shared by the grid tiles and the
 * list rows so together they never ask for more than six at a time, and a busy answer is retried.
 * `alive` stops the work when the tile or row has gone.
 */
export function loadThumbnail(api: DepotApi, objectId: string, alive: () => boolean): Promise<string | null> {
  const ready = knownThumbnail(objectId);
  if (ready) {
    return Promise.resolve(ready);
  }
  const running = pending.get(objectId);
  if (running) {
    running.alive.push(alive);
    return running.lookup;
  }
  const callers = [alive];
  const lookup = fetchThumbnail(api, objectId, () => callers.some((a) => a()))
    .finally(() => pending.delete(objectId));
  pending.set(objectId, { lookup, alive: callers });
  return lookup;
}

async function fetchThumbnail(api: DepotApi, objectId: string, alive: () => boolean): Promise<string | null> {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await acquire();
    if (!alive()) {
      release();
      return null;
    }
    try {
      const t = await firstValueFrom(api.thumbnail(objectId));
      const until = t.expiresAt ? Date.parse(t.expiresAt) : NaN;
      if (!Number.isNaN(until)) {
        known.set(objectId, { url: t.url, until });
      }
      return t.url;
    } catch (e) {
      if (!RETRYABLE.has(ApiError.from(e).reason) || attempt === RETRIES) {
        return null;           // no picture for this file: the caller keeps its icon
      }
    } finally {
      release();
    }
    await sleep(2000 * attempt);
    if (!alive()) {
      return null;
    }
  }
  return null;
}

/** Calls `onVisible` once, when `el` scrolls near the screen. Returns a function that stops watching. */
export function whenVisible(el: Element, onVisible: () => void): () => void {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      onVisible();
    }
  }, { rootMargin: '200px' });
  observer.observe(el);
  return () => observer.disconnect();
}
