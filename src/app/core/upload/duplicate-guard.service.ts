import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { DuplicateFile } from '../api/models';
import { DepotApi } from '../api/depot-api.service';
import { ConfirmService } from '../ui/confirm.service';

/** What to upload after the duplicate check, and the files skipped because the folder has them. */
export interface DuplicateDecision {
  upload: File[];
  /** Skipped files with the copy already in the folder (an album can add that one instead). */
  skipped: { file: File; existing: DuplicateFile }[];
}

const key = (name: string, size: number): string => `${name}\u0000${size}`;

/**
 * Before uploading, asks the API which files the folder already holds (same name and size). When there
 * are some, asks the user once for the batch whether to upload them again; No skips them. The same file
 * chosen twice in one batch is only uploaded once. If the check itself fails, the upload goes ahead.
 */
@Injectable({ providedIn: 'root' })
export class DuplicateGuard {
  private readonly api = inject(DepotApi);
  private readonly confirm = inject(ConfirmService);

  async check(namespace: string, picked: File[]): Promise<DuplicateDecision> {
    const seen = new Set<string>();
    const files = picked.filter((f) => {
      const k = `${key(f.name, f.size)}\u0000${f.lastModified}`;
      if (seen.has(k)) {
        return false;
      }
      seen.add(k);
      return true;
    });
    if (files.length === 0) {
      return { upload: [], skipped: [] };
    }
    let found: DuplicateFile[];
    try {
      found = (await firstValueFrom(this.api.duplicates(namespace,
        files.map((f) => ({ filename: f.name, size: f.size }))))).duplicates;
    } catch {
      return { upload: files, skipped: [] };
    }
    if (found.length === 0) {
      return { upload: files, skipped: [] };
    }
    const existing = new Map(found.map((d) => [key(d.filename, d.size), d]));
    const dupes = files.filter((f) => existing.has(key(f.name, f.size)));
    const shown = dupes.slice(0, 5).map((f) => f.name).join(', ');
    const more = dupes.length > 5 ? ` and ${dupes.length - 5} more` : '';
    const again = await this.confirm.ask({
      header: dupes.length === 1 ? 'Already uploaded' : `${dupes.length} files already uploaded`,
      message: `${shown}${more} ${dupes.length === 1 ? 'is' : 'are'} already in ${namespace}. `
        + `Upload ${dupes.length === 1 ? 'it' : 'them'} again?`,
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (again) {
      return { upload: files, skipped: [] };
    }
    return {
      upload: files.filter((f) => !existing.has(key(f.name, f.size))),
      skipped: dupes.map((f) => ({ file: f, existing: existing.get(key(f.name, f.size))! })),
    };
  }
}
