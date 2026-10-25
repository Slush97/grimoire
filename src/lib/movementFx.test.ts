import { describe, expect, it } from 'vitest';
import { movementFxSchema, movementFxSaveSchema } from './movementFx';

describe('movement effect drafts', () => {
  it('restores older choices with neutral finish settings', () => {
    expect(movementFxSchema.parse({ kind: 'dash', color: '#ff00ff', image: null })).toMatchObject({
      brightness: 1, illuminated: false, outline: false, outlineColor: '#ffffff', palette: { mode: 'solid' },
    });
  });
  it('rejects unsafe brightness and keeps the image-only effect boundary', () => {
    for (const brightness of [0, 4.1, NaN, Infinity]) {
      expect(movementFxSchema.safeParse({ kind: 'dash', color: '#ff00ff', image: null, brightness }).success).toBe(false);
    }
    expect(movementFxSchema.safeParse({ kind: 'heavy-melee', color: '#ff00ff', image: 'data:image/png;base64,AAAA' }).success).toBe(false);
  });
  it('accepts a bounded PNG thumbnail with the saved effect', () => {
    const choice = { kind: 'dash', color: '#ff00ff', image: null };
    expect(movementFxSaveSchema.safeParse({ choice, thumbnailDataUrl: 'data:image/png;base64,AAAA' }).success).toBe(true);
    expect(movementFxSaveSchema.safeParse({ choice, thumbnailDataUrl: 'https://example.com/image.png' }).success).toBe(false);
    expect(movementFxSaveSchema.safeParse({ choice, thumbnailDataUrl: `data:image/png;base64,${'A'.repeat(1_000_000)}` }).success).toBe(false);
  });
});
