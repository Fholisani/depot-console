import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepotApi } from '../api/depot-api.service';
import { UploadProgress, UploadTask } from './upload.service';

const MIB = 1024 * 1024;
const PART = 16 * MIB;

/** Stands in for storage: each PUT stays in flight until the test finishes it. */
class FakeXhr {
  static all: FakeXhr[] = [];
  status = 0;
  aborted = false;
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  url = '';

  constructor() {
    FakeXhr.all.push(this);
  }
  open(_method: string, url: string): void {
    this.url = url;
  }
  setRequestHeader(): void {}
  getResponseHeader(): string {
    return '"etag-' + this.url + '"';
  }
  send(): void {}
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  finish(): void {
    this.status = 200;
    this.onload?.();
  }
}

/** Lets pending promise continuations run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

/**
 * Waits until `condition` holds. Parts are hashed with real SHA-256 before they are sent, which
 * takes longer on a busy machine than a fixed number of ticks, so tests wait for the state they need.
 */
const until = async (condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> => {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  await settle();
};

describe('UploadTask pause and resume', () => {
  const received = new Map<number, number>();
  let phases: UploadProgress[];
  let api: DepotApi;
  let completed: { parts: { partNumber: number }[] } | null;

  beforeEach(() => {
    FakeXhr.all = [];
    received.clear();
    phases = [];
    completed = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const partCount = 5;
    api = {
      createUpload: () => of({ uploadId: 'u1', partSize: PART, partCount }),
      partTarget: (_id: string, n: number) =>
        of({ partNumber: n, request: { url: `part-${n}`, method: 'PUT', headers: {} } }),
      uploadStatus: () =>
        of({
          received: [...received].map(([partNumber, size]) => ({ partNumber, size, etag: `"etag-part-${partNumber}"` })),
          missing: Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !received.has(n)),
        }),
      completeUpload: (_id: string, body: { parts: { partNumber: number }[] }) => {
        completed = body;
        return of({ objectId: 'o1', status: 'READY' });
      },
      abortUpload: () => of(undefined),
    } as unknown as DepotApi;
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Completes the PUT for `part` and records it as held by storage. */
  const finishPart = (part: number): void => {
    const xhr = FakeXhr.all.find((x) => x.url === `part-${part}` && !x.aborted && x.status === 0);
    expect(xhr, `part ${part} should be in flight`).toBeDefined();
    received.set(part, PART);
    xhr!.finish();
  };

  it('keeps the parts already sending when paused, and resumes only the missing ones', async () => {
    const file = new File([new ArrayBuffer(70 * MIB)], 'big.lrf');
    const task = new UploadTask(api, 'default', file, (p) => phases.push(p));
    const result = task.start();
    await until(() => FakeXhr.all.length >= 3, 'three parts on the wire');
    // Three parts (the concurrency limit) are on the wire; none has finished.
    expect(FakeXhr.all.map((x) => x.url)).toEqual(['part-1', 'part-2', 'part-3']);

    task.pause();
    await until(() => phases.at(-1)?.phase === 'pausing', 'pausing');
    // Pausing must not throw away what is already being sent.
    expect(FakeXhr.all.every((x) => !x.aborted)).toBe(true);
    expect(phases.at(-1)?.phase).toBe('pausing');
    expect(FakeXhr.all).toHaveLength(3);                 // and no new part was started

    finishPart(1);
    finishPart(2);
    finishPart(3);
    await until(() => phases.at(-1)?.phase === 'paused', 'paused');
    expect(phases.at(-1)?.phase).toBe('paused');
    expect(phases.at(-1)?.percent).toBeGreaterThanOrEqual(68);   // 48 of 70 MiB kept, not 0
    expect(FakeXhr.all).toHaveLength(3);

    task.resume();
    await until(() => FakeXhr.all.length >= 5, 'the two missing parts');
    // Only the two missing parts are sent after resume.
    expect(FakeXhr.all.slice(3).map((x) => x.url).sort()).toEqual(['part-4', 'part-5']);
    finishPart(4);
    finishPart(5);
    await expect(result).resolves.toMatchObject({ objectId: 'o1' });
    expect(completed!.parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('pausing when nothing is in flight reports paused straight away', async () => {
    const file = new File([new ArrayBuffer(70 * MIB)], 'big.lrf');
    const task = new UploadTask(api, 'default', file, (p) => phases.push(p));
    void task.start().catch(() => undefined);
    await until(() => FakeXhr.all.length >= 3, 'three parts on the wire');
    finishPart(1);
    finishPart(2);
    finishPart(3);
    task.pause();
    await until(() => phases.at(-1)?.phase === 'paused', 'paused');
    expect(phases.at(-1)?.phase).toBe('paused');
    task.cancel();
  });

  it('cancel still aborts the parts on the wire', async () => {
    const file = new File([new ArrayBuffer(70 * MIB)], 'big.lrf');
    const task = new UploadTask(api, 'default', file, (p) => phases.push(p));
    const result = task.start();
    await until(() => FakeXhr.all.length >= 3, 'three parts on the wire');
    task.cancel();
    await expect(result).rejects.toThrow('Upload cancelled');
    expect(FakeXhr.all.every((x) => x.aborted)).toBe(true);
  });
});
