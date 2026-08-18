import { describe, expect, it, vi } from 'vitest';
import {
  resolveImportVariantGroupIds,
  resolvePersistedImportVariantGroupIds,
} from './importVariantGroups';

describe('resolveImportVariantGroupIds', () => {
  it('mints one id for every item sharing a batch key', () => {
    const mint = vi.fn(() => 'group-1');
    expect(resolveImportVariantGroupIds([
      { localGroupBatchKey: 'picked-files' },
      { localGroupBatchKey: 'picked-files' },
    ], mint)).toEqual(['group-1', 'group-1']);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('mints separate ids for separate batch keys', () => {
    let next = 0;
    expect(resolveImportVariantGroupIds([
      { localGroupBatchKey: 'a' },
      { localGroupBatchKey: 'b' },
      { localGroupBatchKey: 'a' },
    ], () => `group-${++next}`)).toEqual(['group-1', 'group-2', 'group-1']);
  });

  it('keeps an explicit group id for partial-failure retries', () => {
    const mint = vi.fn(() => 'unused');
    expect(resolveImportVariantGroupIds([
      { localGroupId: ' existing-group ', localGroupBatchKey: 'picked-files' },
    ], mint)).toEqual(['existing-group']);
    expect(mint).not.toHaveBeenCalled();
  });

  it('leaves ordinary and blank-key imports ungrouped', () => {
    const mint = vi.fn(() => 'unused');
    expect(resolveImportVariantGroupIds([
      {},
      { localGroupBatchKey: '   ' },
      { localGroupId: '' },
    ], mint)).toEqual([undefined, undefined, undefined]);
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('resolvePersistedImportVariantGroupIds', () => {
  it('gives an early failed row the group created by a later batch row', () => {
    expect(
      resolvePersistedImportVariantGroupIds(
        ['shared-group', 'shared-group'],
        new Set(['shared-group'])
      )
    ).toEqual(['shared-group', 'shared-group']);
  });

  it('drops a freshly minted id when no source in that group persisted', () => {
    expect(
      resolvePersistedImportVariantGroupIds(
        ['rolled-back', undefined],
        new Set()
      )
    ).toEqual([undefined, undefined]);
  });
});
