import { describe, expect, it } from 'vitest';
import { sizeGameBananaThumbUrl } from './gameBananaImage';

describe('sizeGameBananaThumbUrl', () => {
  const url = 'https://images.gamebanana.com/img/ss/mods/530-90_abc.jpg';
  const small = 'https://images.gamebanana.com/img/ss/mods/220-90_abc.jpg';

  it('swaps a 530 URL for its 220 sibling when 220 covers', () => {
    expect(sizeGameBananaThumbUrl(url, 56, 2)).toBe(small);
    expect(sizeGameBananaThumbUrl(url, 220, 1)).toBe(small);
  });

  it('keeps the 530 URL when the box needs more pixels', () => {
    expect(sizeGameBananaThumbUrl(url, 160, 2)).toBe(url);
    expect(sizeGameBananaThumbUrl(url, 221, 1)).toBe(url);
  });

  it('counts the height of a cover box taller than a screenshot', () => {
    // A 200px 16:9 box fits a 220 image; a 200px 3:2 card would upscale it.
    expect(sizeGameBananaThumbUrl(url, 200, 1, 112)).toBe(small);
    expect(sizeGameBananaThumbUrl(url, 200, 1, 133)).toBe(url);
    expect(sizeGameBananaThumbUrl(url, 128, 1, 80)).toBe(small);
    expect(sizeGameBananaThumbUrl(url, 128, 2, 80)).toBe(url);
  });

  it('leaves originals, local files and other hosts alone', () => {
    expect(sizeGameBananaThumbUrl('https://images.gamebanana.com/img/ss/mods/abc.jpg', 56, 1)).toBe('https://images.gamebanana.com/img/ss/mods/abc.jpg');
    expect(sizeGameBananaThumbUrl('grimoire-asset://thumbs/530-90_abc.jpg', 56, 1)).toBe('grimoire-asset://thumbs/530-90_abc.jpg');
    expect(sizeGameBananaThumbUrl('https://example.com/img/530-90_abc.jpg', 56, 1)).toBe('https://example.com/img/530-90_abc.jpg');
  });
});
