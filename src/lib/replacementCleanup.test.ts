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
        { id: 'moved-old-a', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'moved-old-b', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 },
      ],
      [
        { id: 'old-a', gameBananaId: 7, gameBananaFileId: 9 },
        { id: 'old-b', gameBananaId: 7, gameBananaFileId: 9 },
      ],
      10,
    )).toEqual(['moved-old-a', 'moved-old-b']);
  });
});
