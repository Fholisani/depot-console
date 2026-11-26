import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../config/app-config';
import type { CreateUpload } from './models';
import { DepotApi } from './depot-api.service';

const ok = (data: unknown): object => ({ data, errors: [], message: 'OK' });

describe('DepotApi.visitorUploads: the owner-shaped upload calls of a share link', () => {
  let api: DepotApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { apiBase: '/depot', auth: { authority: 'x', clientId: 'y' } } },
      ],
    });
    api = TestBed.inject(DepotApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends a photo to the link, never to a folder of the owner', async () => {
    const v = api.visitorUploads('tok/en');
    const events = lastValueFrom(v.uploadSimple('ignored', new File([new Uint8Array(3)], 'IMG 1.jpg', { type: 'image/jpeg' }), 'abc'));
    const req = http.expectOne((r) => r.url === '/depot/v1/share/tok%2Fen/objects');
    expect(req.request.method).toBe('PUT');
    expect(req.request.params.get('filename')).toBe('IMG 1.jpg');
    expect(req.request.params.has('namespace')).toBe(false);
    expect(req.request.headers.get('X-Depot-Sha256')).toBe('abc');
    req.flush(ok({ objectId: 'o1' }));
    const last = await events;
    expect(last.type).toBe(HttpEventType.Response);
  });

  it('starts, sends, checks and finishes a large file through the link', async () => {
    const v = api.visitorUploads('t1');
    const created = firstValueFrom(v.createUpload({ namespace: 'default', filename: 'ride.mov',
      contentType: 'video/quicktime', size: 99 } as CreateUpload, 'key-1'));
    const c = http.expectOne('/depot/v1/share/t1/uploads');
    expect(c.request.method).toBe('POST');
    expect(c.request.body).toEqual({ filename: 'ride.mov', contentType: 'video/quicktime', size: 99, sha256: undefined });
    expect(c.request.headers.get('Idempotency-Key')).toBe('key-1');
    c.flush(ok({ uploadId: 'u1' }));
    expect(await created).toMatchObject({ uploadId: 'u1' });

    const part = firstValueFrom(v.partTarget('u1', 2, 'c2hh'));
    const p = http.expectOne('/depot/v1/share/t1/uploads/u1/parts/2');
    expect(p.request.body).toEqual({ sha256: 'c2hh' });
    p.flush(ok({ partNumber: 2 }));
    await part;

    const status = firstValueFrom(v.uploadStatus('u1'));
    http.expectOne((r) => r.method === 'GET' && r.url === '/depot/v1/share/t1/uploads/u1').flush(ok({ received: [] }));
    await status;

    const done = firstValueFrom(v.completeUpload('u1', { parts: [] }));
    http.expectOne('/depot/v1/share/t1/uploads/u1/complete').flush(ok({ objectId: 'o2' }));
    expect(await done).toMatchObject({ objectId: 'o2' });

    const stopped = firstValueFrom(v.abortUpload('u1'));
    const a = http.expectOne((r) => r.method === 'DELETE' && r.url === '/depot/v1/share/t1/uploads/u1');
    a.flush(ok(null));
    await stopped;
  });

  it('cannot look into the owner\'s folders: no duplicates, no objects', async () => {
    const v = api.visitorUploads('t1');
    expect(await firstValueFrom(v.duplicates('default', [{ filename: 'a.jpg', size: 1 }]))).toEqual({ duplicates: [] });
    await expect(firstValueFrom(v.object('o1'))).rejects.toMatchObject({ reason: 'RESOURCE_NOT_FOUND' });
  });
});
