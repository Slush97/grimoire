import { describe, expect, it } from 'vitest';
import { findReplacementTargetIdsAfterInstall } from './replacementCleanup';

describe('findReplacementTargetIdsAfterInstall', () => {
  it('deletes only the original ids when reinstalling the same file', () => {
    expect(findReplacementTargetIdsAfterInstall(
      [
        { id: 'old', gameBananaId: 7, gameBananaFileId: 10 },
        { id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 },
      ],
      [{ id: 'old', gameBananaId: 7, gameBananaFileId: 10 }],
      10,
    )).toEqual(['old']);
  });

  it('follows stale update sources whose local ids changed during auto-disable', () => {
    expect(findReplacementTargetIdsAfterInstall(
      [
        { id: 'moved-old-a', gameBananaId: 7, gameBananaFileId: 9, vpkIndex: 0 },
        { id: 'moved-old-b', gameBananaId: 7, gameBananaFileId: 9, vpkIndex: 1 },
        { id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 },
      ],
      [
        { id: 'old-a', gameBananaId: 7, gameBananaFileId: 9, vpkIndex: 0 },
        { id: 'old-b', gameBananaId: 7, gameBananaFileId: 9, vpkIndex: 1 },
      ],
      10,
    )).toEqual(['moved-old-a', 'moved-old-b']);
  });

  it('preserves untargeted siblings from the same GameBanana file', () => {
    expect(findReplacementTargetIdsAfterInstall(
      [
        { id: 'moved-target', gameBananaId: 7, gameBananaFileId: 9, sha256: 'target-hash' },
        { id: 'ignored-sibling', gameBananaId: 7, gameBananaFileId: 9, sha256: 'ignored-hash' },
        { id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, sha256: 'fresh-hash' },
      ],
      [
        { id: 'old-target', gameBananaId: 7, gameBananaFileId: 9, sha256: 'target-hash' },
      ],
      10,
    )).toEqual(['moved-target']);
  });

  it('does not guess between legacy siblings when only one was targeted', () => {
    expect(findReplacementTargetIdsAfterInstall(
      [
        { id: 'moved-target', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'ignored-sibling', gameBananaId: 7, gameBananaFileId: 9 },
      ],
      [{ id: 'old-target', gameBananaId: 7, gameBananaFileId: 9 }],
      10,
    )).toEqual([]);
  });

  it('cleans a complete legacy provenance group when every sibling was targeted', () => {
    expect(findReplacementTargetIdsAfterInstall(
      [
        { id: 'moved-a', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'moved-b', gameBananaId: 7, gameBananaFileId: 9 },
      ],
      [
        { id: 'old-a', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'old-b', gameBananaId: 7, gameBananaFileId: 9 },
      ],
      10,
    )).toEqual(['moved-a', 'moved-b']);
  });
});
