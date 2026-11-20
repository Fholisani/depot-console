import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { DepotApi } from '../api/depot-api.service';
import { forgetThumbnails, knownThumbnail, loadThumbnail } from './thumbnail-loader';

const inMinutes = (m: number): string => new Date(Date.now() + m * 60_000).toISOString();

describe('thumbnail loader', () => {
  afterEach(() => forgetThumbnails());

  it('asks for up to six at once, not two', async () => {
    const answers: Array<Subject<{ url: string; expiresAt: string }>> = [];
    const api = { thumbnail: () => { const s = new Subject<{ url: string; expiresAt: string }>(); answers.push(s); return s; } } as unknown as DepotApi;
    const loads = Array.from({ length: 8 }, (_, i) => loadThumbnail(api, `o${i}`, () => true));
    await Promise.resolve();
    expect(answers).toHaveLength(6);
    answers.forEach((s, i) => { s.next({ url: `u${i}`, expiresAt: inMinutes(15) }); s.complete(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(answers.length).toBe(8);                 // the last two start as the first ones finish
    answers.slice(6).forEach((s, i) => { s.next({ url: `u${i + 6}`, expiresAt: inMinutes(15) }); s.complete(); });
    expect(await Promise.all(loads)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7']);
  });

  it('reuses a link while it is still good, so the browser can show the copy it kept', async () => {
    let calls = 0;
    const api = { thumbnail: () => { calls++; return of({ url: `u${calls}`, expiresAt: inMinutes(15) }); } } as unknown as DepotApi;
    expect(await loadThumbnail(api, 'a', () => true)).toBe('u1');
    expect(await loadThumbnail(api, 'a', () => true)).toBe('u1');
    expect(calls).toBe(1);
    expect(knownThumbnail('a', Date.now() + 14.5 * 60_000)).toBeNull();   // under a minute left: ask again
  });

  it('shares one request between two tiles of the same file', async () => {
    let calls = 0;
    const answer = new Subject<{ url: string; expiresAt: string }>();
    const api = { thumbnail: () => { calls++; return answer; } } as unknown as DepotApi;
    let firstShown = true;
    const first = loadThumbnail(api, 'b', () => firstShown);
    const second = loadThumbnail(api, 'b', () => true);
    firstShown = false;                               // the first tile scrolled away; the second still wants it
    await new Promise((r) => setTimeout(r, 0));       // let the request go out
    answer.next({ url: 'ub', expiresAt: inMinutes(15) });
    answer.complete();
    expect(await second).toBe('ub');
    expect(await first).toBe('ub');
    expect(calls).toBe(1);
  });

  it('remembers nothing for files without a picture, and forgets on sign-out', async () => {
    const none = { thumbnail: () => throwError(() => ({ status: 404 })) } as unknown as DepotApi;
    expect(await loadThumbnail(none, 'c', () => true)).toBeNull();
    expect(knownThumbnail('c')).toBeNull();
    const api = { thumbnail: () => of({ url: 'ud', expiresAt: inMinutes(15) }) } as unknown as DepotApi;
    await loadThumbnail(api, 'd', () => true);
    forgetThumbnails();
    expect(knownThumbnail('d')).toBeNull();
  });
});
