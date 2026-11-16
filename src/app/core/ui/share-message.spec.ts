import { describe, expect, it } from 'vitest';
import { albumMessage, describeItems, fileMessage, messageText } from './share-message';

describe('share messages', () => {
  it('names what an album holds', () => {
    expect(describeItems(['image', 'image', 'video'], 3)).toBe('2 photos and 1 video');
    expect(describeItems(['image'], 1)).toBe('1 photo');
    expect(describeItems(['image', 'video', 'pdf'], 3)).toBe('1 photo, 1 video and 1 document');
    expect(describeItems(['image', 'image'], 30)).toBe('30 items');
    expect(describeItems([], 0)).toBe('0 items');
  });

  it('puts the album name, the description and the contents before the link', () => {
    const m = albumMessage({ name: 'Braai 14', description: 'Stokvel discussion' }, null,
      '6 photos', 'Mashegana', 'https://fmash.online/depot-console/s/abc?slot=passive');
    expect(m.title).toBe('Braai 14');
    expect(messageText(m)).toBe('Braai 14\nStokvel discussion\n6 photos · shared by Mashegana\n'
      + 'https://fmash.online/depot-console/s/abc?slot=passive');
  });

  it('prefers the note written when sharing over the album description', () => {
    const m = albumMessage({ name: 'Braai 14', description: 'Stokvel discussion' }, '  Sunday pics ',
      '6 photos', null, 'u');
    expect(m.text).toBe('Braai 14\nSunday pics\n6 photos');
  });

  it('describes a single file', () => {
    expect(messageText(fileMessage('IMG_0612.jpeg', '', '8.73 MB', 'Mashegana', 'u')))
      .toBe('IMG_0612.jpeg\n8.73 MB · shared by Mashegana\nu');
  });
});
