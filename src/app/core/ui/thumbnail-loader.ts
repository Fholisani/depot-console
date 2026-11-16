import { firstValueFrom } from 'rxjs';
import { ApiError } from '../api/api-error';
import type { DepotApi } from '../api/depot-api.service';

/**
 * Only two pictures are asked for at once, the number the service makes at the same time; the
 * first view of a folder of large photos makes their thumbnails one by one.
 */
const MAX_IN_FLIGHT = 2;
/** Busy or briefly unreachable: ask again after 2 s, 4 s, 6 s … up to this many times. */
const RETRIES = 8;
const RETRYABLE = new Set<ApiError['reason']>(['RATE_LIMITED', 'STORAGE_UNAVAILABLE', 'NETWORK_ERROR']);

let inFlight = 0;
const waiting: Array<() => void> = [];

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

/**
 * The URL of a file's 480 px thumbnail, or null when it has none. Shared by the grid tiles and the
 * list rows so together they never ask for more than two at a time, and a busy answer is retried.
 * `alive` stops the work when the tile or row has gone.
 */
export async function loadThumbnail(api: DepotApi, objectId: string, alive: () => boolean): Promise<string | null> {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await acquire();
    if (!alive()) {
      release();
      return null;
    }
    try {
      return (await firstValueFrom(api.thumbnail(objectId))).url;
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
