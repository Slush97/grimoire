import { describe, expect, it } from 'vitest';
import { movementFxSchema, movementFxSaveSchema, parryPartArgs } from './movementFx';

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
  it('takes a shield symbol and stun icon on the parry only', () => {
    const png = 'data:image/png;base64,AAAA';
    expect(movementFxSchema.parse({ kind: 'parry', color: '#ff00ff', image: png, stunImage: png })).toMatchObject({ image: png, stunImage: png });
    expect(movementFxSchema.parse({ kind: 'dash', color: '#ff00ff', image: null }).stunImage).toBeNull();
    expect(movementFxSchema.safeParse({ kind: 'dash', color: '#ff00ff', image: null, stunImage: png }).success).toBe(false);
  });
  it('colors each part of a parry on its own', () => {
    const part = (color: string, original = false) => ({ original, color, palette: { mode: 'solid' } });
    const parts = { linked: false, shield: part('#ff0000'), catch: { ...part('#00ff00'), palette: { mode: 'gradient', end: '#0000ff' } }, stun: part('#ffffff', true) };
    const choice = movementFxSchema.parse({ kind: 'parry', color: '#ff00ff', image: null, parts });
    expect(parryPartArgs(choice.parts)).toEqual(['shield=#ff0000', 'catch=#00ff00:#0000ff', 'stun=original']);
    // Linked parts take the main color: only an original part is named
    expect(parryPartArgs({ ...choice.parts!, linked: true })).toEqual(['stun=original']);
    // A parry saved before parts is every part linked
    expect(movementFxSchema.parse({ kind: 'parry', color: '#ff00ff', image: null }).parts).toBeNull();
    expect(parryPartArgs(null)).toEqual([]);
    expect(movementFxSchema.safeParse({ kind: 'dash', color: '#ff00ff', image: null, parts }).success).toBe(false);
    const allOriginal = { linked: true, shield: part('#ff0000', true), catch: part('#ff0000', true), stun: part('#ff0000', true) };
    expect(movementFxSchema.safeParse({ kind: 'parry', color: '#ff00ff', image: null, parts: allOriginal }).success).toBe(false);
    expect(movementFxSchema.safeParse({ kind: 'parry', color: '#ff00ff', image: 'data:image/png;base64,AAAA', parts: allOriginal }).success).toBe(true);
  });
  it('accepts a bounded PNG thumbnail with the saved effect', () => {
    const choice = { kind: 'dash', color: '#ff00ff', image: null };
    expect(movementFxSaveSchema.safeParse({ choice, thumbnailDataUrl: 'data:image/png;base64,AAAA' }).success).toBe(true);
    expect(movementFxSaveSchema.safeParse({ choice, thumbnailDataUrl: 'https://example.com/image.png' }).success).toBe(false);
    expect(movementFxSaveSchema.safeParse({ choice, thumbnailDataUrl: `data:image/png;base64,${'A'.repeat(1_000_000)}` }).success).toBe(false);
  });
});
