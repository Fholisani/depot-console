import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackService } from './back.service';

describe('BackService', () => {
  const events = new Subject<unknown>();
  const navigateByUrl = vi.fn();
  const back = vi.fn();
  let service: BackService;
  let id = 0;
  const go = (url: string): void => events.next(new NavigationEnd(++id, url, url));

  beforeEach(() => {
    navigateByUrl.mockReset();
    back.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { events, navigateByUrl } },
        { provide: Location, useValue: { back } },
      ],
    });
    service = TestBed.inject(BackService);
  });

  it('goes to the fallback when the page was opened directly', () => {
    go('/app/files/abc');
    expect(service.label('Files')).toBe('Files');
    service.back('/app/files');
    expect(navigateByUrl).toHaveBeenCalledWith('/app/files');
    expect(back).not.toHaveBeenCalled();
  });

  it('goes back to the album it came from, by name', () => {
    go('/app/albums/a1');
    go('/app/files/abc');
    expect(service.previousAlbumId()).toBe('a1');
    expect(service.label('Files', { album: 'Braai 14' })).toBe('Back to Braai 14');
    service.back('/app/files');
    expect(back).toHaveBeenCalled();
  });

  it('treats the viewer opening and moving (?view=) as the same page', () => {
    go('/app/files');
    go('/app/files?view=x');
    go('/app/files?view=y');
    go('/app/files/y');
    expect(service.label('Files')).toBe('Back to Files');
  });
});
