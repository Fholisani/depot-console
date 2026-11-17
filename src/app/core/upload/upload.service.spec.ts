import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api-error';
import type { DepotApi } from '../api/depot-api.service';
import { RESUMABLE_FROM, UploadProgress, UploadTask, sessionKey } from './upload.service';

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
  /** The connection dropped (for example the phone screen locked). */
  fail(): void {
    this.onerror?.();
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
    // Parts start concurrently (each after hashing), so their order varies; only the set matters.
    expect(FakeXhr.all.map((x) => x.url).sort()).toEqual(['part-1', 'part-2', 'part-3']);

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

/** Yields one real event-loop turn (not affected by fake timers), so real async work can finish. */
const realTick = (): Promise<void> => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    resolve();
  };
  channel.port2.postMessage(null);
});

describe('UploadTask small-file retry', () => {
  const storageDown = (): HttpErrorResponse => new HttpErrorResponse({
    status: 503,
    error: { data: null, message: 'STORAGE_UNAVAILABLE',
      errors: [{ code: 3501, message: 'The blob store is unreachable', reason: 'STORAGE_UNAVAILABLE' }] },
  });
  const ok = of({ type: HttpEventType.Response, body: { data: { objectId: 'o1', status: 'READY' } } });

  afterEach(() => vi.useRealTimers());

  const run = async (responses: unknown[]): Promise<{ result: Promise<unknown>; calls: () => number }> => {
    // Fake only the retry delays. The file hash runs on real crypto and needs the real event loop,
    // so the loop below advances fake time and also yields a real macrotask until the upload settles,
    // however slow the machine is.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let calls = 0;
    const api = {
      uploadSimple: () => responses[Math.min(calls++, responses.length - 1)],
    } as unknown as DepotApi;
    const task = new UploadTask(api, 'default', new File([new Uint8Array(10)], 'a.jpg'), () => undefined);
    let settled = false;
    const result = task.start();
    result.then(() => (settled = true), () => (settled = true));
    for (let i = 0; i < 2000 && !settled; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      await realTick();
    }
    return { result, calls: () => calls };
  };

  it('retries when storage is briefly unavailable, then succeeds', async () => {
    const { result, calls } = await run([throwError(storageDown), throwError(storageDown), ok]);
    await expect(result).resolves.toMatchObject({ objectId: 'o1' });
    expect(calls()).toBe(3);
  });

  it('gives up after three attempts and reports the storage error', async () => {
    const { result, calls } = await run([throwError(storageDown)]);
    await expect(result).rejects.toMatchObject({ reason: 'STORAGE_UNAVAILABLE' });
    expect(calls()).toBe(3);
  });

  it('does not retry errors that will not go away', async () => {
    const forbidden = new HttpErrorResponse({ status: 403, error: { data: null, message: 'x',
      errors: [{ code: 3104, message: 'No', reason: 'INSUFFICIENT_ROLE' }] } });
    const { result, calls } = await run([throwError(() => forbidden)]);
    await expect(result).rejects.toMatchObject({ reason: 'INSUFFICIENT_ROLE' });
    expect(calls()).toBe(1);
  });
});

describe('UploadTask survives a dropped connection and a page reload', () => {
  const received = new Map<number, number>();
  let phases: UploadProgress[];
  let api: DepotApi;
  let created: number;
  let aborted: number;
  let statusCalls: string[];
  let failNextTarget: unknown;
  const partCount = 5;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    FakeXhr.all = [];
    received.clear();
    localStorage.clear();
    phases = [];
    created = 0;
    aborted = 0;
    statusCalls = [];
    failNextTarget = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    api = {
      createUpload: () => {
        created++;
        return of({ uploadId: 'u1', partSize: PART, partCount, size: 70 * MIB, status: 'OPEN' });
      },
      partTarget: (_id: string, n: number) => {
        if (failNextTarget) {
          const e = failNextTarget;
          failNextTarget = null;
          return throwError(() => e);
        }
        return of({ partNumber: n, request: { url: `part-${n}`, method: 'PUT', headers: {} } });
      },
      uploadStatus: (id: string) => {
        statusCalls.push(id);
        return of({
          uploadId: id, status: 'OPEN', size: 70 * MIB, partSize: PART, partCount,
          received: [...received].map(([partNumber, size]) => ({ partNumber, size, etag: `"etag-part-${partNumber}"` })),
          missing: Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !received.has(n)),
        });
      },
      completeUpload: () => of({ objectId: 'o1', status: 'READY' }),
      abortUpload: () => {
        aborted++;
        return of(undefined);
      },
    } as unknown as DepotApi;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const live = (): FakeXhr[] => FakeXhr.all.filter((x) => !x.aborted && x.status === 0 && x.onerror);
  /**
   * Moves fake time on and yields real time until the condition holds. Bounded by real time, not by a
   * number of rounds: hashing a 16 MiB part takes real time, much more on a slow CI agent (build 20 gave
   * up after 600 quick rounds, under a second, before a part was hashed).
   */
  const until = async (what: string, cond: () => boolean): Promise<void> => {
    const deadline = Date.now() + 45_000;
    while (!cond() && Date.now() < deadline) {
      await vi.advanceTimersByTimeAsync(500);
      await realTick();
      await new Promise<void>((r) => queueMicrotask(r));
    }
    expect(cond(), what).toBe(true);
  };
  const inFlight = (part: number): boolean => live().some((x) => x.url === `part-${part}`);
  const finish = (part: number): void => {
    const xhr = live().find((x) => x.url === `part-${part}`);
    expect(xhr, `part ${part} should be in flight`).toBeDefined();
    received.set(part, PART);
    xhr!.finish();
  };
  const file = (): File => new File([new ArrayBuffer(70 * MIB)], 'ride.mov', { lastModified: 1700000000000 });

  it('keeps the stored parts when the connection drops and carries on by itself', async () => {
    const task = new UploadTask(api, 'default', file(), (p) => phases.push(p));
    const result = task.start();
    await until('part 1 sending', () => inFlight(1));
    finish(1);
    await until('more parts sending', () => live().length > 0);
    // The screen locks: every request on the wire fails at once.
    live().forEach((x) => x.fail());
    await until('waiting for the connection', () => phases.some((p) => p.phase === 'waiting'));
    expect(aborted).toBe(0);                                  // nothing thrown away

    // Back online: it carries on with only the parts storage does not have.
    const before = FakeXhr.all.length;
    for (const n of [2, 3, 4, 5]) {
      await until(`part ${n} sending again`, () => inFlight(n));
      finish(n);
    }
    await expect(result).resolves.toMatchObject({ objectId: 'o1' });
    expect(FakeXhr.all.slice(before).map((x) => x.url)).not.toContain('part-1');
    expect(created).toBe(1);
  }, 60_000);

  it('continues the same session when the same file is chosen again after the page reloaded', async () => {
    // What a reload leaves behind: the session remembered for this file, and parts 1-2 in storage.
    const f = file();
    localStorage.setItem(sessionKey('default', f), 'u1');
    received.set(1, PART);
    received.set(2, PART);

    const again = new UploadTask(api, 'default', f, (p) => phases.push(p));
    const result = again.start();
    for (const n of [3, 4, 5]) {
      await until(`part ${n} sending`, () => inFlight(n));
      finish(n);
    }
    await expect(result).resolves.toMatchObject({ objectId: 'o1' });
    expect(created).toBe(0);                                  // the saved session was continued
    expect(statusCalls).toContain('u1');
    expect(FakeXhr.all.map((x) => x.url).sort()).toEqual(['part-3', 'part-4', 'part-5']);
    expect(localStorage.length).toBe(0);                      // forgotten once complete
  }, 60_000);

  it('still releases the session on a real error', async () => {
    failNextTarget = new ApiError(409, 'PART_CHECKSUM_MISMATCH', 'Part does not match');
    const task = new UploadTask(api, 'default', file(), () => undefined);
    let settled = false;
    const result = task.start();
    result.then(() => (settled = true), () => (settled = true));
    await until('upload settled', () => settled);
    await expect(result).rejects.toMatchObject({ reason: 'PART_CHECKSUM_MISMATCH' });
    expect(aborted).toBe(1);
    expect(localStorage.length).toBe(0);
  }, 60_000);

  it('sends phone-sized videos in resumable parts', () => {
    const video = new File([new ArrayBuffer(20 * MIB)], 'clip.mov');
    expect(video.size).toBeGreaterThan(RESUMABLE_FROM);
    expect(new UploadTask(api, 'default', video, () => undefined).pausable).toBe(true);
  });
});
