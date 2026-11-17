import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DepotApi } from '../api/depot-api.service';
import { ConfirmService } from '../ui/confirm.service';
import { DuplicateGuard } from './duplicate-guard.service';

const file = (name: string, size: number, lastModified = 1): File =>
  new File([new Uint8Array(size)], name, { lastModified });

describe('DuplicateGuard', () => {
  let answer: boolean;
  let asked: { header: string; message: string; confirmText: string; cancelText?: string }[];
  let checked: { filename: string; size: number }[][];
  let existing: { filename: string; size: number }[];
  let fail: boolean;
  let guard: DuplicateGuard;

  beforeEach(() => {
    answer = false;
    asked = [];
    checked = [];
    existing = [];
    fail = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfirmService, useValue: { ask: (o: never) => { asked.push(o); return Promise.resolve(answer); } } },
        { provide: DepotApi, useValue: {
          duplicates: (_ns: string, files: { filename: string; size: number }[]) => {
            checked.push(files);
            if (fail) {
              return throwError(() => new Error('offline'));
            }
            return of({ duplicates: existing.filter((e) => files.some((f) => f.filename === e.filename && f.size === e.size))
              .map((e) => ({ ...e, objectId: `id-${e.filename}`, namespace: 'default', createdAt: '' })) });
          },
        } },
      ],
    });
    guard = TestBed.inject(DuplicateGuard);
  });

  it('uploads everything without asking when nothing is there yet', async () => {
    const r = await guard.check('default', [file('a.jpg', 3), file('b.jpg', 4)]);
    expect(r.upload.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(asked).toHaveLength(0);
  });

  it('asks once for the batch; No skips the files that are already there', async () => {
    existing = [{ filename: 'IMG_0548.jpeg', size: 3 }];
    answer = false;
    const r = await guard.check('default', [file('IMG_0548.jpeg', 3), file('new.jpg', 4)]);
    expect(asked).toHaveLength(1);
    expect(asked[0].confirmText).toBe('Yes');
    expect(asked[0].cancelText).toBe('No');
    expect(asked[0].message).toContain('IMG_0548.jpeg');
    expect(r.upload.map((f) => f.name)).toEqual(['new.jpg']);
    expect(r.skipped.map((s) => s.existing.objectId)).toEqual(['id-IMG_0548.jpeg']);
  });

  it('Yes uploads them again', async () => {
    existing = [{ filename: 'IMG_0548.jpeg', size: 3 }];
    answer = true;
    const r = await guard.check('default', [file('IMG_0548.jpeg', 3)]);
    expect(r.upload.map((f) => f.name)).toEqual(['IMG_0548.jpeg']);
    expect(r.skipped).toHaveLength(0);
  });

  it('the same file chosen twice in one batch is uploaded once', async () => {
    const r = await guard.check('default', [file('a.jpg', 3, 7), file('a.jpg', 3, 7)]);
    expect(r.upload).toHaveLength(1);
    expect(checked[0]).toHaveLength(1);
  });

  it('a failed check does not block the upload', async () => {
    fail = true;
    const r = await guard.check('default', [file('a.jpg', 3)]);
    expect(r.upload).toHaveLength(1);
    expect(asked).toHaveLength(0);
  });
});
