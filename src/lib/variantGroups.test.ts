import { describe, it, expect } from 'vitest';
import type { Mod } from '../types/mod';
import { variantGroupKey } from './variantGroups';

/** Minimal Mod, shaped just enough for the grouping check. */
function mod(over: Partial<Mod> & { id: string }): Mod {
  return {
    name: over.id,
    fileName: `${over.id}.vpk`,
    path: `/addons/${over.id}.vpk`,
    metaKey: `${over.id}.vpk`,
    enabled: true,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('variantGroupKey', () => {
  it('groups GameBanana mods by submission id', () => {
    expect(variantGroupKey(mod({ id: 'a', gameBananaId: 123 }))).toBe('gb:123');
    expect(variantGroupKey(mod({ id: 'b', gameBananaId: 123, gameBananaFileId: 9 }))).toBe('gb:123');
  });

  it('prefers an explicit local group over adopted GameBanana identity', () => {
    const key = variantGroupKey(mod({ id: 'a', gameBananaId: 42, localGroupId: 'uuid-1' }));
    expect(key).toBe('local:uuid-1');
  });

  it('groups local imports by their local group id', () => {
    expect(variantGroupKey(mod({ id: 'a', localGroupId: 'uuid-1' }))).toBe('local:uuid-1');
  });

  it('keeps the two namespaces distinct', () => {
    const gb = variantGroupKey(mod({ id: 'a', gameBananaId: 7 }));
    const local = variantGroupKey(mod({ id: 'b', localGroupId: '7' }));
    expect(gb).not.toBe(local);
  });

  it('returns null for a standalone local mod', () => {
    expect(variantGroupKey(mod({ id: 'a' }))).toBeNull();
  });

  it('rejects a non-positive GameBanana id and falls through', () => {
    expect(variantGroupKey(mod({ id: 'a', gameBananaId: 0 }))).toBeNull();
    expect(variantGroupKey(mod({ id: 'b', gameBananaId: -1 }))).toBeNull();
    expect(variantGroupKey(mod({ id: 'c', gameBananaId: 0, localGroupId: 'uuid-1' }))).toBe(
      'local:uuid-1'
    );
  });

  it('ignores an empty local group id', () => {
    expect(variantGroupKey(mod({ id: 'a', localGroupId: '' }))).toBeNull();
  });
});
