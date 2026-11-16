import { HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiError } from '../api/api-error';
import { DepotApi } from '../api/depot-api.service';
import type { ObjectResult, PartTarget, Upload } from '../api/models';

/** The API's single-request limit (`PUT /v1/objects`). */
export const SIMPLE_LIMIT = 64 * 1024 * 1024;
/**
 * Files above this go in parts, which survive a dropped connection and can be resumed. Lower than the
 * API's single-request limit on purpose: a phone video sent in one request starts again from zero
 * whenever the screen locks.
 */
export const RESUMABLE_FROM = 16 * 1024 * 1024;
/** Waits between attempts to reconnect after the connection dropped; the last one repeats. */
const RECONNECT_DELAYS_MS = [1000, 3000, 5000, 10000, 20000, 30000];
const SESSION_KEY_PREFIX = 'depot.upload.';
/** A part that sends nothing for this long is treated as a dropped connection (a locked phone often
 * leaves the request hanging instead of failing it). */
const STALL_MS = 60_000;
const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 3;
/** Attempts for a single-request upload when storage is briefly unavailable, and the wait before each retry. */
const SIMPLE_ATTEMPTS = 3;
const SIMPLE_RETRY_DELAYS_MS = [2000, 5000];

/** Failures that may succeed if sent again: storage briefly offline, or the connection dropped. */
function retryable(e: unknown): boolean {
  return e instanceof ApiError && (e.reason === 'STORAGE_UNAVAILABLE' || e.reason === 'NETWORK_ERROR');
}

/** What an upload is doing right now, for the progress display. */
/**
 * `pausing`: pause was requested and the parts already on the wire are still finishing. They are not
 * aborted, because storage cannot keep half a part: aborting would throw their bytes away and resume
 * would start those parts again.
 */
/**
 * `waiting`: the connection dropped (for example the phone screen locked); the parts already stored are
 * kept and the upload carries on by itself when the page is back and online.
 */
export type UploadPhase = 'preparing' | 'uploading' | 'pausing' | 'paused' | 'waiting' | 'finishing';

export interface UploadProgress {
  phase: UploadPhase;
  /** 0-100. */
  percent: number;
}

type ProgressFn = (p: UploadProgress) => void;

/** Thrown when the user cancels; callers show it as "Cancelled", not as an error. */
export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
  }
}

/** Raised inside a part request when it was stopped on purpose (cancel). */
class Stopped extends Error {}

/** The connection to storage or the API dropped; the upload can carry on once it is back. */
class ConnectionLost extends Error {}

/** True for failures caused by the connection, not by the request itself. */
function connectionProblem(e: unknown): boolean {
  return e instanceof ConnectionLost || (e instanceof ApiError && e.reason === 'NETWORK_ERROR');
}

/** Identifies a file across page reloads, so choosing the same file again continues its upload. */
export function sessionKey(namespace: string, file: File): string {
  return `${SESSION_KEY_PREFIX}${namespace}|${file.name}|${file.size}|${file.lastModified}`;
}

function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSaved(key: string, uploadId: string | null): void {
  try {
    if (uploadId) {
      localStorage.setItem(key, uploadId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // storage unavailable (private mode): resuming after a reload just does not happen
  }
}

/** Resolves once the page is visible and the browser reports a connection. */
function whenBackOnline(): Promise<void> {
  const ready = (): boolean =>
    (typeof document === 'undefined' || document.visibilityState === 'visible')
    && (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (ready()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const check = (): void => {
      if (ready()) {
        document.removeEventListener('visibilitychange', check);
        window.removeEventListener('online', check);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
  });
}

/** Keeps the screen on while an upload runs, where the browser allows it (Screen Wake Lock API). */
class ScreenAwake {
  private lock: { release(): Promise<void> } | null = null;
  private active = false;
  private readonly reacquire = (): void => {
    if (this.active && document.visibilityState === 'visible') {
      void this.request();
    }
  };

  start(): void {
    if (this.active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return;
    }
    this.active = true;
    document.addEventListener('visibilitychange', this.reacquire);
    void this.request();
  }

  stop(): void {
    this.active = false;
    document.removeEventListener('visibilitychange', this.reacquire);
    void this.lock?.release().catch(() => undefined);
    this.lock = null;
  }

  private async request(): Promise<void> {
    try {
      const wl = (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
        .wakeLock;
      this.lock = await wl.request('screen');
    } catch {
      // refused (low battery, not visible): the upload still survives the screen locking
    }
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of one part as base64, the form the API signs into the part's presigned request. */
async function sha256Base64(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  let binary = '';
  digest.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/**
 * One file's upload. Up to 16 MiB goes in one request through the API (cancel only); larger files go in
 * parts straight to storage and can be paused and resumed: resume asks the API which parts it already
 * has (`GET /v1/uploads/{id}`) and sends only the missing ones. A dropped connection keeps the stored
 * parts and carries on by itself; the session is remembered, so choosing the same file again after the
 * page reloaded continues it instead of starting from zero.
 */
export class UploadTask {
  readonly pausable: boolean;

  private paused = false;
  private cancelled = false;
  private resumeWaiter: (() => void) | null = null;
  private readonly inflight = new Set<XMLHttpRequest>();
  private simpleSub: Subscription | null = null;
  private session: Upload | null = null;
  private readonly sentByPart = new Map<number, number>();
  private readonly etags = new Map<number, string>();
  private readonly awake = new ScreenAwake();
  /** Set when a part failed: the other workers stop before sending more. */
  private halted = false;
  private readonly key: string;

  constructor(
    private readonly api: DepotApi,
    private readonly namespace: string,
    readonly file: File,
    private readonly onProgress: ProgressFn,
  ) {
    this.pausable = file.size > RESUMABLE_FROM;
    this.key = sessionKey(namespace, file);
  }

  start(): Promise<ObjectResult> {
    return this.pausable ? this.multipart() : this.simple();
  }

  pause(): void {
    if (!this.pausable || this.paused || this.cancelled) {
      return;
    }
    // Stop starting new parts but let the ones already sending finish: a part is all-or-nothing in
    // storage, so aborting it loses every byte sent so far. The multipart loop reports `paused`
    // once the last in-flight part is done.
    this.paused = true;
    this.onProgress({ phase: this.inflight.size > 0 ? 'pausing' : 'paused', percent: this.percent() });
  }

  resume(): void {
    if (!this.paused || this.cancelled) {
      return;
    }
    this.paused = false;
    this.onProgress({ phase: 'uploading', percent: this.percent() });
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.inflight.forEach((x) => x.abort());
    this.simpleSub?.unsubscribe();
    this.resumeWaiter?.();
    writeSaved(this.key, null);
    this.awake.stop();
    if (this.session) {
      // Releases the reserved quota and the stored parts.
      this.api.abortUpload(this.session.uploadId).subscribe({ error: () => undefined });
    }
  }

  // ------------------------------------------------------------------ single request

  private async simple(): Promise<ObjectResult> {
    this.onProgress({ phase: 'preparing', percent: 0 });
    const sha = await sha256Hex(this.file);
    for (let attempt = 1; ; attempt++) {
      if (this.cancelled) {
        throw new UploadCancelled();
      }
      try {
        return await this.simpleOnce(sha);
      } catch (e) {
        if (this.cancelled || !retryable(e) || attempt >= SIMPLE_ATTEMPTS) {
          throw e;
        }
        // Storage was briefly unavailable: wait, then send the file again from the start.
        this.onProgress({ phase: 'preparing', percent: 0 });
        await this.wait(SIMPLE_RETRY_DELAYS_MS[attempt - 1] ?? 5000);
      }
    }
  }

  /** Resolves after `ms`, or straight away if the upload is cancelled meanwhile. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.resumeWaiter = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private simpleOnce(sha: string): Promise<ObjectResult> {
    this.onProgress({ phase: 'uploading', percent: 0 });
    return new Promise<ObjectResult>((resolve, reject) => {
      this.simpleSub = this.api.uploadSimple(this.namespace, this.file, sha).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = event.total ?? this.file.size;
            const percent = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
            this.onProgress(percent >= 100 ? { phase: 'finishing', percent: 100 } : { phase: 'uploading', percent });
          } else if (event.type === HttpEventType.Response && event.body) {
            resolve(event.body.data);
          }
        },
        error: (e) => reject(ApiError.from(e)),
      });
      // unsubscribe() on cancel ends the request without an error event; settle the promise here.
      this.simpleSub.add(() => {
        if (this.cancelled) {
          reject(new UploadCancelled());
        }
      });
    });
  }

  // ------------------------------------------------------------------ multipart

  private async multipart(): Promise<ObjectResult> {
    this.onProgress({ phase: 'preparing', percent: 0 });
    this.awake.start();
    try {
      const session = await this.openSession();
      this.session = session;
      writeSaved(this.key, session.uploadId);
      try {
        let missing = await this.missingParts(session);
        let drops = 0;
        for (;;) {
          if (this.cancelled) {
            throw new UploadCancelled();
          }
          try {
            if (!this.paused && missing.length > 0) {
              this.onProgress({ phase: 'uploading', percent: this.percent() });
              await this.sendParts(session, missing);
            }
            if (this.cancelled) {
              throw new UploadCancelled();
            }
            if (this.paused) {
              this.onProgress({ phase: 'paused', percent: this.percent() });
              await new Promise<void>((r) => (this.resumeWaiter = r));
            } else if (this.etags.size === session.partCount) {
              break;
            }
            // After a pause or a round of parts, trust the store: ask which parts it holds.
            missing = await this.missingParts(session);
            drops = 0;
          } catch (e) {
            if (!connectionProblem(e) || this.cancelled) {
              throw e;
            }
            // The connection dropped (screen locked, network changed). Keep every stored part, wait
            // until the page is back and online, then carry on with what is still missing.
            this.onProgress({ phase: 'waiting', percent: this.percent() });
            await whenBackOnline();
            await this.wait(RECONNECT_DELAYS_MS[Math.min(drops++, RECONNECT_DELAYS_MS.length - 1)]);
            try {
              missing = await this.missingParts(session);
            } catch (again) {
              if (!connectionProblem(again)) {
                throw again;
              }
              missing = [];            // still offline: the next round fails fast and waits again
              this.etags.clear();
            }
          }
        }
        this.onProgress({ phase: 'finishing', percent: 100 });
        const parts = [...this.etags.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([partNumber, etag]) => ({ partNumber, etag }));
        const result = await this.completeWithRetry(session, parts);
        writeSaved(this.key, null);
        return result;
      } catch (e) {
        if (!(e instanceof UploadCancelled) && !connectionProblem(e)) {
          // A real failure (not a dropped connection): release the quota and the parts.
          writeSaved(this.key, null);
          this.api.abortUpload(session.uploadId).subscribe({ error: () => undefined });
        }
        throw e;
      }
    } finally {
      this.awake.stop();
    }
  }

  /** Continues the session saved for this file if it is still open; otherwise starts a new one. */
  private async openSession(): Promise<Upload> {
    const saved = readSaved(this.key);
    if (saved) {
      try {
        const st = await firstValueFrom(this.api.uploadStatus(saved));
        if (st.status === 'OPEN' && st.size === this.file.size) {
          return { uploadId: st.uploadId, objectId: st.objectId, versionId: st.versionId, mode: 'MULTIPART',
            status: st.status, size: st.size, partSize: st.partSize, partCount: st.partCount,
            expiresAt: st.expiresAt } as Upload;
        }
      } catch (e) {
        if (connectionProblem(e)) {
          throw e;
        }
        // gone or expired: start a new one
      }
      writeSaved(this.key, null);
    }
    return firstValueFrom(this.api.createUpload({
      namespace: this.namespace,
      filename: this.file.name,
      contentType: this.file.type || 'application/octet-stream',
      size: this.file.size,
    }, crypto.randomUUID()));
  }

  /** Completing is safe to repeat; retry it across a dropped connection instead of losing the upload. */
  private async completeWithRetry(session: Upload, parts: { partNumber: number; etag: string }[]): Promise<ObjectResult> {
    for (let drops = 0; ; drops++) {
      try {
        return await firstValueFrom(this.api.completeUpload(session.uploadId, { parts }));
      } catch (e) {
        if (!connectionProblem(e) || this.cancelled) {
          throw e;
        }
        this.onProgress({ phase: 'waiting', percent: 99 });
        await whenBackOnline();
        await this.wait(RECONNECT_DELAYS_MS[Math.min(drops, RECONNECT_DELAYS_MS.length - 1)]);
        this.onProgress({ phase: 'finishing', percent: 100 });
      }
    }
  }

  /** Parts the store does not have yet; records the ETags of those it has. */
  private async missingParts(session: Upload): Promise<number[]> {
    const status = await firstValueFrom(this.api.uploadStatus(session.uploadId));
    for (const p of status.received) {
      this.etags.set(p.partNumber, p.etag);
      this.sentByPart.set(p.partNumber, p.size);
    }
    for (const n of status.missing) {
      this.etags.delete(n);
      this.sentByPart.set(n, 0);
    }
    return status.missing;
  }

  private async sendParts(session: Upload, numbers: number[]): Promise<void> {
    const queue = [...numbers];
    let failure: unknown = null;
    this.halted = false;
    const worker = async (): Promise<void> => {
      for (let n = queue.shift(); n !== undefined && !this.paused && !this.cancelled && failure === null;
        n = queue.shift()) {
        try {
          this.etags.set(n, await this.sendPart(session, n));
        } catch (e) {
          if (!(e instanceof Stopped) && failure === null) {
            failure = e;               // stops the other workers from taking more parts
            this.halted = true;
            // Parts still on the wire would be resent anyway; stop them so none hangs (a request cut
            // by a locked screen can hang without failing).
            this.inflight.forEach((x) => x.abort());
          }
          return;
        }
      }
    };
    // Wait for every worker, so none is still sending when the caller decides what to do next.
    await Promise.allSettled(Array.from({ length: PART_CONCURRENCY }, worker));
    if (failure !== null) {
      throw failure;
    }
  }

  private async sendPart(session: Upload, partNumber: number): Promise<string> {
    const start = (partNumber - 1) * session.partSize;
    const body = this.file.slice(start, Math.min(start + session.partSize, this.file.size));
    const sha = await sha256Base64(body);
    if (this.halted || this.paused || this.cancelled) {
      throw new Stopped();
    }
    let target: PartTarget = await firstValueFrom(this.api.partTarget(session.uploadId, partNumber, sha));
    for (let attempt = 1; ; attempt++) {
      try {
        if (this.halted || this.cancelled) {
          throw new Stopped();
        }
        const etag = await this.put(target.request, body, (loaded) => this.report(partNumber, loaded));
        if (!etag) {
          throw new ApiError(0, 'UNKNOWN',
            'Storage did not expose the part ETag. Allow the ETag header in the storage CORS rules.');
        }
        return etag;
      } catch (e) {
        this.report(partNumber, 0);
        if (e instanceof Stopped || e instanceof ApiError || e instanceof ConnectionLost
            || attempt >= PART_ATTEMPTS) {
          throw e;
        }
        target = await firstValueFrom(this.api.partTarget(session.uploadId, partNumber, sha));
      }
    }
  }

  private report(partNumber: number, loaded: number): void {
    this.sentByPart.set(partNumber, loaded);
    if (!this.cancelled) {
      this.onProgress({ phase: this.paused ? 'pausing' : 'uploading', percent: Math.min(99, this.percent()) });
    }
  }

  private percent(): number {
    let sent = 0;
    this.sentByPart.forEach((v) => (sent += v));
    return this.file.size > 0 ? Math.floor((sent / this.file.size) * 100) : 0;
  }

  /** One presigned request straight to storage with XHR (reports upload progress, can be aborted). */
  private put(
    request: { url: string; method: string; headers: Record<string, string> },
    body: Blob,
    onLoaded: (bytes: number) => void,
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.inflight.add(xhr);
      let done = (): void => void this.inflight.delete(xhr);
      xhr.open(request.method, request.url);
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        if (!/^(host|content-length)$/i.test(name)) {
          xhr.setRequestHeader(name, value);
        }
      }
      let lastProgress = Date.now();
      let stalled = false;
      const watchdog = setInterval(() => {
        if (Date.now() - lastProgress > STALL_MS) {
          stalled = true;
          xhr.abort();
        }
      }, 5000);
      const prevDone = done;
      done = (): void => {
        clearInterval(watchdog);
        prevDone();
      };
      xhr.upload.onprogress = (e) => {
        lastProgress = Date.now();
        onLoaded(e.loaded);
      };
      xhr.onload = () => {
        done();
        if (xhr.status >= 200 && xhr.status < 300) {
          onLoaded(body.size);
          resolve(xhr.getResponseHeader('ETag'));
        } else {
          reject(new Error(`Storage answered ${xhr.status}`));
        }
      };
      xhr.onerror = () => {
        done();
        reject(new ConnectionLost('Storage could not be reached'));
      };
      xhr.onabort = () => {
        done();
        reject(stalled ? new ConnectionLost('Storage stopped answering') : new Stopped());
      };
      xhr.send(body);
    });
  }
}

/** Creates upload tasks; one per file. */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly api = inject(DepotApi);

  create(namespace: string, file: File, onProgress: ProgressFn): UploadTask {
    return new UploadTask(this.api, namespace, file, onProgress);
  }
}
