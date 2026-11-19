import { describe, expect, it } from 'vitest';
import { previewVersion } from './slot.service';

describe('previewVersion', () => {
  it('is short, stable and changes when anything in the preview changes', () => {
    const v = previewVersion('Braai 14', 'Stokvel discussion', 'cover-1', null);
    expect(v).toMatch(/^[a-z0-9]{1,8}$/);
    expect(previewVersion('Braai 14', 'Stokvel discussion', 'cover-1', null)).toBe(v);
    expect(previewVersion('Braai 14', 'Stokvel discussion', 'cover-2', null)).not.toBe(v);
    expect(previewVersion('Braai 15', 'Stokvel discussion', 'cover-1', null)).not.toBe(v);
    expect(previewVersion('Braai 14', 'Stokvel', 'cover-1', null)).not.toBe(v);
    expect(previewVersion('Braai 14', 'Stokvel discussion', 'cover-1', 'Sunday')).not.toBe(v);
    // Fields do not run into each other.
    expect(previewVersion('ab', 'c')).not.toBe(previewVersion('a', 'bc'));
  });
});
