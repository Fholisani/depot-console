import { HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiError } from '../api/api-error';
import { DepotApi } from '../api/depot-api.service';
import type { ObjectResult, PartTarget, Upload } from '../api/models';

/** The API's single-request limit (`PUT /v1/objects`). Larger files use multipart sessions. */
export const SIMPLE_LIMIT = 64 * 1024 * 1024;
const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 3;

/** What an upload is doing right now, for the progress display. */
/**
 * `pausing`: pause was requested and the parts already on the wire are still finishing. They are not
 * aborted, because storage cannot keep half a part: aborting would throw their bytes away and resume
 * would start those parts again.
 */
export type UploadPhase = 'preparing' | 'uploading' | 'pausing' | 'paused' | 'finishing';

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
 * One file's upload. Up to 64 MiB goes in one request through the API (cancel only); larger files
 * go in parts straight to storage and can be paused and resumed: resume asks the API which parts it
 * already has (`GET /v1/uploads/{id}`) and sends only the missing ones.
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

  constructor(
    private readonly api: DepotApi,
    private readonly namespace: string,
    readonly file: File,
    private readonly onProgress: ProgressFn,
  ) {
    this.pausable = file.size > SIMPLE_LIMIT;
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
    if (this.session) {
      // Releases the reserved quota and the stored parts.
      this.api.abortUpload(this.session.uploadId).subscribe({ error: () => undefined });
    }
  }

  // ------------------------------------------------------------------ single request

  private async simple(): Promise<ObjectResult> {
    this.onProgress({ phase: 'preparing', percent: 0 });
    const sha = await sha256Hex(this.file);
    if (this.cancelled) {
      throw new UploadCancelled();
    }
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
    this.session = await firstValueFrom(this.api.createUpload({
      namespace: this.namespace,
      filename: this.file.name,
      contentType: this.file.type || 'application/octet-stream',
      size: this.file.size,
    }, crypto.randomUUID()));
    const session = this.session;
    try {
      let missing = Array.from({ length: session.partCount }, (_, i) => i + 1);
      for (;;) {
        if (this.cancelled) {
          throw new UploadCancelled();
        }
        if (!this.paused) {
          this.onProgress({ phase: 'uploading', percent: this.percent() });
          await this.sendParts(session, missing);
        }
        if (this.cancelled) {
          throw new UploadCancelled();
        }
        if (this.paused) {
          this.onProgress({ phase: 'paused', percent: this.percent() });
          await new Promise<void>((r) => (this.resumeWaiter = r));
          // After a pause, trust the store: ask which parts it already holds.
          missing = await this.missingParts(session);
          continue;
        }
        if (this.etags.size === session.partCount) {
          break;
        }
        missing = await this.missingParts(session);
      }
      this.onProgress({ phase: 'finishing', percent: 100 });
      const parts = [...this.etags.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([partNumber, etag]) => ({ partNumber, etag }));
      return await firstValueFrom(this.api.completeUpload(session.uploadId, { parts }));
    } catch (e) {
      if (!(e instanceof UploadCancelled)) {
        this.api.abortUpload(session.uploadId).subscribe({ error: () => undefined });
      }
      throw e;
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
    const worker = async (): Promise<void> => {
      for (let n = queue.shift(); n !== undefined && !this.paused && !this.cancelled; n = queue.shift()) {
        try {
          this.etags.set(n, await this.sendPart(session, n));
        } catch (e) {
          if (e instanceof Stopped) {
            return;                      // cancelled (pause no longer aborts); the outer loop decides
          }
          throw e;
        }
      }
    };
    await Promise.all(Array.from({ length: PART_CONCURRENCY }, worker));
  }

  private async sendPart(session: Upload, partNumber: number): Promise<string> {
    const start = (partNumber - 1) * session.partSize;
    const body = this.file.slice(start, Math.min(start + session.partSize, this.file.size));
    const sha = await sha256Base64(body);
    let target: PartTarget = await firstValueFrom(this.api.partTarget(session.uploadId, partNumber, sha));
    for (let attempt = 1; ; attempt++) {
      try {
        const etag = await this.put(target.request, body, (loaded) => this.report(partNumber, loaded));
        if (!etag) {
          throw new ApiError(0, 'UNKNOWN',
            'Storage did not expose the part ETag. Allow the ETag header in the storage CORS rules.');
        }
        return etag;
      } catch (e) {
        this.report(partNumber, 0);
        if (e instanceof Stopped || e instanceof ApiError || attempt >= PART_ATTEMPTS) {
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
      const done = (): void => void this.inflight.delete(xhr);
      xhr.open(request.method, request.url);
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        if (!/^(host|content-length)$/i.test(name)) {
          xhr.setRequestHeader(name, value);
        }
      }
      xhr.upload.onprogress = (e) => onLoaded(e.loaded);
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
        reject(new Error('Storage could not be reached'));
      };
      xhr.onabort = () => {
        done();
        reject(new Stopped());
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
