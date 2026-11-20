import { describe, expect, it } from 'vitest';
import {
  extendedMessage, formatDuration, formatRecorded, hasPicture, hasThumbnail, isNumericName, kindOf, linkStats, timeAgo,
} from './media';

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

  it('asks for a video picture only once its poster exists', () => {
    expect(hasThumbnail({ filename: 'IMG_0629.mov', contentType: 'video/quicktime' })).toBe(false);
    expect(hasThumbnail({ filename: 'IMG_0629.mov', contentType: 'video/quicktime', poster: false })).toBe(false);
    expect(hasThumbnail({ filename: 'IMG_0629.mov', contentType: 'video/quicktime', poster: true })).toBe(true);
    expect(hasThumbnail({ filename: 'clip.mp4', contentType: null, thumbnail: true })).toBe(true);
    expect(hasThumbnail({ filename: 'a.jpg', contentType: 'image/jpeg' })).toBe(true);
  });

  it('formats a video length', () => {
    expect(formatDuration(42_400)).toBe('0:42');
    expect(formatDuration(725_000)).toBe('12:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('formats a recording date and spots names that are only numbers', () => {
    expect(formatRecorded('2023-12-24T18:30:05Z')).toContain('2023');
    expect(formatRecorded(null)).toBe('');
    expect(formatRecorded('not a date')).toBe('');
    expect(isNumericName('20231224_203005.mp4')).toBe(true);
    expect(isNumericName('1703442605.mov')).toBe(true);
    expect(isNumericName('IMG_0629.mov')).toBe(false);
    expect(isNumericName('birthday.mp4')).toBe(false);
  });

  it('tells the owner how long an extended link now works', () => {
    expect(extendedMessage(null)).toContain('until you stop sharing');
    expect(extendedMessage('2027-01-15T10:00:00Z')).toMatch(/until .*2027/);
    expect(extendedMessage('2027-01-15T10:00:00Z')).toContain('nothing to resend');
  });
});
