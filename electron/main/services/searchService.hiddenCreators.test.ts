import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/grimoire-search-test' } }));

import { normalizeHiddenCreatorIds } from './searchService';

describe('normalizeHiddenCreatorIds', () => {
  it('keeps unique positive safe integers in user-defined order', () => {
    expect(normalizeHiddenCreatorIds([42, 7, 42, 9])).toEqual([42, 7, 9]);
  });

  it('drops values that cannot be safe GameBanana submitter ids', () => {
    expect(normalizeHiddenCreatorIds([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 12]))
      .toEqual([12]);
  });

  it('caps the exclusion list to a bounded number of SQL parameters', () => {
    const ids = Array.from({ length: 1200 }, (_, index) => index + 1);
    const normalized = normalizeHiddenCreatorIds(ids);

    expect(normalized).toHaveLength(1000);
    expect(normalized[0]).toBe(1);
    expect(normalized[999]).toBe(1000);
  });
});
