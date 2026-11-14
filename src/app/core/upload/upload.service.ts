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

/** Whole-file SHA-256 as lowercase hex, so the server can verify what it stored. */
async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Uploads a file: up to 64 MiB in one request through the API, larger files in parts sent straight
 * to storage with presigned requests (create, send parts, complete). Reports 0-100 progress.
 */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly api = inject(DepotApi);

  async upload(
    namespace: string, file: File, onProgress: (percent: number) => void,
  ): Promise<ObjectResult> {
    onProgress(0);
    const result = file.size <= SIMPLE_LIMIT
      ? await this.simple(namespace, file, onProgress)
      : await this.multipart(namespace, file, onProgress);
    onProgress(100);
    return result;
  }

  private async simple(
    namespace: string, file: File, onProgress: (percent: number) => void,
  ): Promise<ObjectResult> {
    const sha = await sha256Hex(file);
    return new Promise<ObjectResult>((resolve, reject) => {
      this.api.uploadSimple(namespace, file, sha).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          } else if (event.type === HttpEventType.Response && event.body) {
            resolve(event.body.data);
          }
        },
        error: (e) => reject(ApiError.from(e)),
      });
    });
  }

  private async multipart(
    namespace: string, file: File, onProgress: (percent: number) => void,
  ): Promise<ObjectResult> {
    const session = await firstValueFrom(this.api.createUpload({
      namespace,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }, crypto.randomUUID()));

    try {
      const parts = session.mode === 'MULTIPART'
        ? await this.sendParts(session, file, onProgress)
        : await this.sendWhole(session, file, onProgress);
      return await firstValueFrom(this.api.completeUpload(session.uploadId, { parts }));
    } catch (e) {
      // Release the reserved quota; the original failure is what the caller needs to see.
      this.api.abortUpload(session.uploadId).subscribe({ error: () => undefined });
      throw e;
    }
  }

  private async sendWhole(
    session: Upload, file: File, onProgress: (percent: number) => void,
  ): Promise<{ partNumber: number; etag: string }[]> {
    if (!session.putUrl) {
      throw new ApiError(0, 'UNKNOWN', 'The server returned no upload target.');
    }
    await this.put(session.putUrl, file);
    onProgress(95);
    return [];
  }

  private async sendParts(
    session: Upload, file: File, onProgress: (percent: number) => void,
  ): Promise<{ partNumber: number; etag: string }[]> {
    const targets = [...(session.parts ?? [])];
    const done: { partNumber: number; etag: string }[] = [];
    let sent = 0;
    const worker = async (): Promise<void> => {
      for (let t = targets.shift(); t; t = targets.shift()) {
        const etag = await this.sendPart(session, file, t);
        done.push({ partNumber: t.partNumber, etag });
        sent += t.size;
        onProgress(Math.min(95, Math.round((sent / file.size) * 95)));
      }
    };
    await Promise.all(Array.from({ length: PART_CONCURRENCY }, worker));
    return done.sort((a, b) => a.partNumber - b.partNumber);
  }

  private async sendPart(session: Upload, file: File, target: PartTarget): Promise<string> {
    const start = (target.partNumber - 1) * session.partSize;
    const body = file.slice(start, start + target.size);
    let current = target;
    for (let attempt = 1; ; attempt++) {
      try {
        const etag = await this.put(current.request, body);
        if (!etag) {
          throw new ApiError(0, 'UNKNOWN',
            'Storage did not expose the part ETag. Allow the ETag header in the storage CORS rules.');
        }
        return etag;
      } catch (e) {
        if (e instanceof ApiError || attempt >= PART_ATTEMPTS) {
          throw e;
        }
        // The presigned URL may have expired; ask for a fresh one and try again.
        current = await firstValueFrom(this.api.partTarget(session.uploadId, target.partNumber));
      }
    }
  }

  /** Sends one presigned request to storage. Returns the ETag header when storage exposes it. */
  private async put(
    request: { url: string; method: string; headers: Record<string, string> }, body: Blob,
  ): Promise<string | null> {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body });
    if (!response.ok) {
      throw new Error(`Storage answered ${response.status}`);
    }
    return response.headers.get('ETag');
  }
}
