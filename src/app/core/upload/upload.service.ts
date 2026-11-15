import { HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../api/api-error';
import { DepotApi } from '../api/depot-api.service';
import type { ObjectResult, PartTarget, Upload } from '../api/models';

/** The API's single-request limit (`PUT /v1/objects`). Larger files use multipart sessions. */
export const SIMPLE_LIMIT = 64 * 1024 * 1024;
const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 3;

/** What an upload is doing right now, for the progress display. */
export type UploadPhase = 'preparing' | 'uploading' | 'finishing';

export interface UploadProgress {
  phase: UploadPhase;
  /** 0-100; only meaningful while uploading. */
  percent: number;
}

type ProgressFn = (p: UploadProgress) => void;

/** Whole-file SHA-256 as lowercase hex, so the server can verify what it stored. */
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
 * Uploads a file: up to 64 MiB in one request through the API, larger files in parts sent straight
 * to storage with presigned requests (create, send parts, complete). Progress is reported in bytes
 * as they leave the browser, for both paths.
 */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly api = inject(DepotApi);

  async upload(namespace: string, file: File, onProgress: ProgressFn): Promise<ObjectResult> {
    return file.size <= SIMPLE_LIMIT
      ? this.simple(namespace, file, onProgress)
      : this.multipart(namespace, file, onProgress);
  }

  private async simple(namespace: string, file: File, onProgress: ProgressFn): Promise<ObjectResult> {
    onProgress({ phase: 'preparing', percent: 0 });
    const sha = await sha256Hex(file);
    onProgress({ phase: 'uploading', percent: 0 });
    return new Promise<ObjectResult>((resolve, reject) => {
      this.api.uploadSimple(namespace, file, sha).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = event.total ?? file.size;
            const percent = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
            // All bytes sent: the server is now storing and checking the file.
            onProgress(percent >= 100 ? { phase: 'finishing', percent: 100 } : { phase: 'uploading', percent });
          } else if (event.type === HttpEventType.Response && event.body) {
            resolve(event.body.data);
          }
        },
        error: (e) => reject(ApiError.from(e)),
      });
    });
  }

  private async multipart(namespace: string, file: File, onProgress: ProgressFn): Promise<ObjectResult> {
    onProgress({ phase: 'preparing', percent: 0 });
    const session = await firstValueFrom(this.api.createUpload({
      namespace,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }, crypto.randomUUID()));

    // Bytes sent so far per part; the sum drives the percentage, so it moves smoothly.
    const sentByPart = new Map<number, number>();
    const report = (partNumber: number, loaded: number): void => {
      sentByPart.set(partNumber, loaded);
      let sent = 0;
      sentByPart.forEach((v) => (sent += v));
      onProgress({ phase: 'uploading', percent: Math.min(99, Math.floor((sent / file.size) * 100)) });
    };

    try {
      onProgress({ phase: 'uploading', percent: 0 });
      const parts = session.mode === 'MULTIPART'
        ? await this.sendParts(session, file, report)
        : await this.sendWhole(session, file, report);
      onProgress({ phase: 'finishing', percent: 100 });
      return await firstValueFrom(this.api.completeUpload(session.uploadId, { parts }));
    } catch (e) {
      // Release the reserved quota; the original failure is what the caller needs to see.
      this.api.abortUpload(session.uploadId).subscribe({ error: () => undefined });
      throw e;
    }
  }

  private async sendWhole(
    session: Upload, file: File, report: (part: number, loaded: number) => void,
  ): Promise<{ partNumber: number; etag: string }[]> {
    if (!session.putUrl) {
      throw new ApiError(0, 'UNKNOWN', 'The server returned no upload target.');
    }
    await this.put(session.putUrl, file, (loaded) => report(1, loaded));
    return [];
  }

  private async sendParts(
    session: Upload, file: File, report: (part: number, loaded: number) => void,
  ): Promise<{ partNumber: number; etag: string }[]> {
    // Each part's presigned request is signed with that part's SHA-256, so storage rejects damaged
    // bytes. The checksum is computed per slice just before the part is sent (bounded memory).
    const queue = Array.from({ length: session.partCount }, (_, i) => i + 1);
    const done: { partNumber: number; etag: string }[] = [];
    const worker = async (): Promise<void> => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        const etag = await this.sendPart(session, file, n, report);
        done.push({ partNumber: n, etag });
      }
    };
    await Promise.all(Array.from({ length: PART_CONCURRENCY }, worker));
    if (done.length !== session.partCount) {
      throw new ApiError(0, 'UNKNOWN', `Only ${done.length} of ${session.partCount} parts were sent.`);
    }
    return done.sort((a, b) => a.partNumber - b.partNumber);
  }

  private async sendPart(
    session: Upload, file: File, partNumber: number, report: (part: number, loaded: number) => void,
  ): Promise<string> {
    const start = (partNumber - 1) * session.partSize;
    const body = file.slice(start, Math.min(start + session.partSize, file.size));
    const sha = await sha256Base64(body);
    let current: PartTarget = await firstValueFrom(this.api.partTarget(session.uploadId, partNumber, sha));
    for (let attempt = 1; ; attempt++) {
      try {
        const etag = await this.put(current.request, body, (loaded) => report(partNumber, loaded));
        if (!etag) {
          throw new ApiError(0, 'UNKNOWN',
            'Storage did not expose the part ETag. Allow the ETag header in the storage CORS rules.');
        }
        return etag;
      } catch (e) {
        report(partNumber, 0);                  // this part starts again from zero
        if (e instanceof ApiError || attempt >= PART_ATTEMPTS) {
          throw e;
        }
        // The presigned URL may have expired; ask for a fresh one and try again.
        current = await firstValueFrom(this.api.partTarget(session.uploadId, partNumber, sha));
      }
    }
  }

  /**
   * Sends one presigned request straight to storage with XMLHttpRequest, which (unlike fetch) reports
   * upload progress. Resolves with the ETag header when storage exposes it.
   */
  private put(
    request: { url: string; method: string; headers: Record<string, string> },
    body: Blob,
    onLoaded: (bytes: number) => void,
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(request.method, request.url);
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        // The browser sets these itself and refuses to have them set by script.
        if (!/^(host|content-length)$/i.test(name)) {
          xhr.setRequestHeader(name, value);
        }
      }
      xhr.upload.onprogress = (e) => onLoaded(e.loaded);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onLoaded(body.size);
          resolve(xhr.getResponseHeader('ETag'));
        } else {
          reject(new Error(`Storage answered ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Storage could not be reached'));
      xhr.onabort = () => reject(new Error('Upload cancelled'));
      xhr.send(body);
    });
  }
}
