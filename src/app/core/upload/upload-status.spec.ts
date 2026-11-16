import { describe, expect, it } from 'vitest';
import { uploadStatusText } from './upload-status';

const MB = 1024 * 1024;

describe('uploadStatusText', () => {
  it('shows the percentage and bytes while uploading', () => {
    expect(uploadStatusText('uploading', 42, 100 * MB)).toMatch(/^Uploading 42% · 42(\.0)? MB of 100(\.0)? MB$/);
  });
  it('says the upload carries on by itself after the connection dropped', () => {
    expect(uploadStatusText('waiting', 30, 100 * MB)).toContain('Connection lost at 30%');
    expect(uploadStatusText('waiting', 30, 100 * MB)).toContain('continues by itself');
  });
  it('covers the other phases', () => {
    expect(uploadStatusText('paused', 10)).toBe('Paused at 10%');
    expect(uploadStatusText('preparing', 0)).toBe('Preparing…');
    expect(uploadStatusText('finishing', 100)).toBe('Finishing…');
  });
});
