import { describe, expect, it } from 'vitest';
import { pickGameBananaImageFile, sizeGameBananaThumbUrl } from './gameBananaImage';
import { getModThumbnail } from '../types/gamebanana';

const full = { baseUrl: 'https://images.gamebanana.com/img/ss/mods', file: 'abc.jpg', file220: '220-90_abc.jpg', file530: '530-90_abc.jpg' };

describe('pickGameBananaImageFile', () => {
  it('uses file220 when it covers the displayed width at the pixel ratio', () => {
    expect(pickGameBananaImageFile(full, 128, 1)).toBe('220-90_abc.jpg');
    expect(pickGameBananaImageFile(full, 110, 2)).toBe('220-90_abc.jpg');
    expect(pickGameBananaImageFile(full, 220, 1)).toBe('220-90_abc.jpg');
  });

  it('steps up to file530 once 220 would be upscaled', () => {
    expect(pickGameBananaImageFile(full, 221, 1)).toBe('530-90_abc.jpg');
    expect(pickGameBananaImageFile(full, 128, 2)).toBe('530-90_abc.jpg');
    expect(pickGameBananaImageFile(full, 300, 1.25)).toBe('530-90_abc.jpg');
  });

  it('never reaches for the original when file530 exists, however wide the box', () => {
    expect(pickGameBananaImageFile(full, 1600, 2)).toBe('530-90_abc.jpg');
    expect(pickGameBananaImageFile(full)).toBe('530-90_abc.jpg');
  });

  it('derives the 220 sibling from a lone 530 name (local catalog rows)', () => {
    const local = { baseUrl: full.baseUrl, file: '530-90_abc.jpg', file530: '530-90_abc.jpg' };
    expect(pickGameBananaImageFile(local, 128, 1)).toBe('220-90_abc.jpg');
    expect(pickGameBananaImageFile(local, 300, 1)).toBe('530-90_abc.jpg');
  });

  it('falls back to the original only when no sized variant covers (GameBanana skips 530 for small uploads)', () => {
    const small = { baseUrl: full.baseUrl, file: 'abc.jpg', file220: '220-90_abc.jpg' };
    expect(pickGameBananaImageFile(small, 128, 1)).toBe('220-90_abc.jpg');
    expect(pickGameBananaImageFile(small, 300, 1)).toBe('abc.jpg');
    expect(pickGameBananaImageFile({ baseUrl: full.baseUrl, file: 'abc.jpg' }, 128, 1)).toBe('abc.jpg');
  });

  it('feeds getModThumbnail', () => {
    expect(getModThumbnail({ previewMedia: { images: [full] } }, 128)).toBe(`${full.baseUrl}/220-90_abc.jpg`);
    expect(getModThumbnail({ previewMedia: { images: [full] } })).toBe(`${full.baseUrl}/530-90_abc.jpg`);
    expect(getModThumbnail({ previewMedia: { images: [] } }, 128)).toBeUndefined();
  });
});

describe('sizeGameBananaThumbUrl', () => {
  const url = 'https://images.gamebanana.com/img/ss/mods/530-90_abc.jpg';

  it('swaps a 530 URL for its 220 sibling when 220 covers', () => {
    expect(sizeGameBananaThumbUrl(url, 56, 2)).toBe('https://images.gamebanana.com/img/ss/mods/220-90_abc.jpg');
  });

  it('keeps the 530 URL when the box needs more pixels', () => {
    expect(sizeGameBananaThumbUrl(url, 160, 2)).toBe(url);
  });

  it('leaves originals, local files and other hosts alone', () => {
    expect(sizeGameBananaThumbUrl('https://images.gamebanana.com/img/ss/mods/abc.jpg', 56, 1)).toBe('https://images.gamebanana.com/img/ss/mods/abc.jpg');
    expect(sizeGameBananaThumbUrl('grimoire-asset://thumbs/530-90_abc.jpg', 56, 1)).toBe('grimoire-asset://thumbs/530-90_abc.jpg');
    expect(sizeGameBananaThumbUrl('https://example.com/img/530-90_abc.jpg', 56, 1)).toBe('https://example.com/img/530-90_abc.jpg');
  });
});
