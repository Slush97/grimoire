import { describe, expect, it } from 'vitest';
import { buildListDragItems, canDropListItem, listHeaderDragId } from './modListDrag';
import { buildInstalledListGroups, installedListEntryKey, UNLISTED_GROUP_ID } from './installedListGroups';
import { buildModEntries } from './modEntries';
import type { Mod } from '../types/mod';

const mod: Mod = { id: 'one', name: 'One', fileName: 'one.vpk', metaKey: 'one.vpk', path: '/one.vpk', enabled: true, priority: 1, size: 10, installedAt: '2026-10-26', sha256: 'one' };
const [entry] = buildModEntries([mod]);

describe('list drag identities', () => {
  it('tracks which occurrence was picked up when a mod belongs to multiple lists', () => {
    const groups = buildInstalledListGroups([entry], [{ id: 'a', name: 'A', keys: ['sha256:one'] }, { id: 'b', name: 'B', keys: ['sha256:one'] }]);
    const items = buildListDragItems(groups);
    expect(items.get(installedListEntryKey('a', entry))).toEqual({ kind: 'entry', entry, sourceId: 'a' });
    expect(items.get(installedListEntryKey('b', entry))).toEqual({ kind: 'entry', entry, sourceId: 'b' });
    expect(items.get(listHeaderDragId('a'))).toEqual({ kind: 'list', id: 'a' });
  });

  it('allows mods into unlisted, keeps that section fixed, and rejects same-list drops', () => {
    expect(canDropListItem({ kind: 'entry', entry, sourceId: 'a' }, UNLISTED_GROUP_ID)).toBe(true);
    expect(canDropListItem({ kind: 'entry', entry, sourceId: 'a' }, 'a')).toBe(false);
    expect(canDropListItem({ kind: 'list', id: 'a' }, UNLISTED_GROUP_ID)).toBe(false);
    expect(canDropListItem({ kind: 'list', id: 'a' }, 'a')).toBe(false);
    expect(canDropListItem({ kind: 'list', id: 'a' }, 'b')).toBe(true);
  });
});
