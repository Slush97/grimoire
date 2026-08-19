import { describe, expect, it } from 'vitest';
import { planLocalVariantUpdateRestore } from './localVariantUpdateRestore';

describe('planLocalVariantUpdateRestore', () => {
  it('reattaches fresh replacements through the still-installed grouped source', () => {
    expect(planLocalVariantUpdateRestore(
      [{ id: 'old-before-rename', localGroupId: 'group-1' }],
      [
        { id: 'old-after-rename', localGroupId: 'group-1', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'fresh-a', gameBananaId: 7, gameBananaFileId: 10 },
        { id: 'fresh-b', gameBananaId: 7, gameBananaFileId: 10 },
      ],
      ['old-after-rename'],
      7,
      10,
    )).toEqual({
      sourceModId: 'old-after-rename',
      sourceGameBananaFileId: 9,
      replacementModIds: ['fresh-a', 'fresh-b'],
      expectedGameBananaId: 7,
      replacementGameBananaFileId: 10,
    });
  });

  it('does not group a mixed grouped and ordinary GameBanana replacement set', () => {
    expect(planLocalVariantUpdateRestore(
      [
        { id: 'grouped', localGroupId: 'group-1' },
        { id: 'ordinary' },
      ],
      [
        { id: 'grouped', localGroupId: 'group-1' },
        { id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 },
      ],
      ['grouped'],
      7,
      10,
    )).toBeNull();
  });

  it('requires a surviving source and excludes cleanup targets from replacements', () => {
    expect(planLocalVariantUpdateRestore(
      [{ id: 'old', localGroupId: 'group-1' }],
      [
        { id: 'old', localGroupId: 'group-1', gameBananaId: 7, gameBananaFileId: 10 },
        { id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 },
      ],
      ['old'],
      7,
      10,
    )?.replacementModIds).toEqual(['fresh']);

    expect(planLocalVariantUpdateRestore(
      [{ id: 'old', localGroupId: 'group-1' }],
      [{ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 }],
      ['old'],
      7,
      10,
    )).toBeNull();
  });
});
