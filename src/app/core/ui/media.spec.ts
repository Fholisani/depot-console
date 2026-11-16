import { describe, expect, it } from 'vitest';
import { hasPicture, kindOf, linkStats, timeAgo } from './media';

describe('media helpers', () => {
  it('reads the kind from the type, or from the extension when the type is generic', () => {
    expect(kindOf('a.jpeg', 'image/jpeg')).toBe('image');
    expect(kindOf('IMG_0629.mov', 'application/octet-stream')).toBe('video');
    expect(kindOf('CAM_0262_D.LRF', null)).toBe('video');
    expect(kindOf('song.mp3', '')).toBe('audio');
    expect(kindOf('doc.pdf', 'application/pdf')).toBe('pdf');
    expect(kindOf('notes.txt', 'text/plain')).toBe('other');
    expect(kindOf('noextension', undefined)).toBe('other');
  });

  it('knows which photos get a picture', () => {
    expect(hasPicture('IMG_0612.jpeg', 'image/jpeg')).toBe(true);
    expect(hasPicture('x.bin', 'image/png')).toBe(true);
    expect(hasPicture('photo.heic', 'image/heic')).toBe(false);
    expect(hasPicture('clip.mov', 'video/quicktime')).toBe(false);
  });

  it('says how long ago something happened', () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-11-15T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-15T11:59:00Z', now)).toBe('1 minute ago');
    expect(timeAgo('2026-11-15T10:00:00Z', now)).toBe('2 hours ago');
    expect(timeAgo('2026-11-12T12:00:00Z', now)).toBe('3 days ago');
  });

  it('describes a link\'s counts', () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    expect(linkStats({ views: 12, downloads: 4, lastViewedAt: '2026-11-15T10:00:00Z' }, now))
      .toBe('12 views · 4 downloads · last opened 2 hours ago');
    expect(linkStats({ views: 1, downloads: 1, lastViewedAt: null }, now))
      .toBe('1 view · 1 download · not opened yet');
  });
});
