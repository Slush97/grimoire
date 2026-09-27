import { describe, expect, it } from 'vitest';
import { getPrimaryFile, type GameBananaFile } from './gamebanana';

const file = (id: number, downloadCount: number, isArchived = false): GameBananaFile => ({
  id,
  fileName: `file-${id}.zip`,
  fileSize: 1,
  downloadUrl: `https://gamebanana.com/dl/${id}`,
  downloadCount,
  isArchived,
});

describe('getPrimaryFile', () => {
  it('picks the most downloaded file', () => {
    expect(getPrimaryFile([file(1, 10), file(2, 50), file(3, 20)]).id).toBe(2);
  });

  it('skips an archived file even when it has the most downloads', () => {
    expect(getPrimaryFile([file(1, 900, true), file(2, 50), file(3, 20)]).id).toBe(2);
  });

  it('falls back to the most downloaded archived file when every file is archived', () => {
    expect(getPrimaryFile([file(1, 5, true), file(2, 70, true)]).id).toBe(2);
  });

  it('keeps the first file on a download-count tie', () => {
    expect(getPrimaryFile([file(1, 10), file(2, 10)]).id).toBe(1);
  });
});
