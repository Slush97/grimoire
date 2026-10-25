import { describe, expect, it } from 'vitest';
import { buildListDragItems, canDropListItem, listDropSlotIndex, listHeaderDragId, listPointerIndex } from './modListDrag';
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

  it('allows same-list moves and unlisted drops while keeping the unlisted section fixed', () => {
    expect(canDropListItem({ kind: 'entry', entry, sourceId: 'a' }, UNLISTED_GROUP_ID)).toBe(true);
    expect(canDropListItem({ kind: 'entry', entry, sourceId: 'a' }, 'a')).toBe(true);
    expect(canDropListItem({ kind: 'list', id: 'a' }, UNLISTED_GROUP_ID)).toBe(false);
    expect(canDropListItem({ kind: 'list', id: 'a' }, 'a')).toBe(false);
    expect(canDropListItem({ kind: 'list', id: 'a' }, 'b')).toBe(true);
  });
});

describe('list drop slot', () => {
  const entries = buildModEntries(['one', 'two', 'three', 'four'].map((id, index) => ({ ...mod, id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, sha256: id, priority: index + 1 })));

  it('appends by default regardless of load order', () => {
    expect(listDropSlotIndex([entries[1], entries[3]], entries[0], null)).toBe(2);
    expect(listDropSlotIndex([], entries[0], null)).toBe(0);
  });

  it('inserts before a member and replaces the source card in the same list', () => {
    expect(listDropSlotIndex(entries, entries[0], 'sha256:two')).toBe(0);
    expect(listDropSlotIndex(entries, entries[0], 'sha256:four')).toBe(2);
    expect(listDropSlotIndex(entries, entries[0], null)).toBe(3);
    expect(listDropSlotIndex(entries, entries[0], 'missing')).toBe(3);
  });
});

describe('pointer insertion', () => {
  const cards = [
    { left: 0, top: 0, width: 100, height: 80 },
    { left: 116, top: 0, width: 100, height: 80 },
    { left: 0, top: 96, width: 100, height: 80 },
    { left: 116, top: 96, width: 100, height: 80 },
  ];

  it('inserts before or after a card across grid rows', () => {
    expect(listPointerIndex(cards, { x: 10, y: 30 }, false)).toBe(0);
    expect(listPointerIndex(cards, { x: 140, y: 30 }, false)).toBe(1);
    expect(listPointerIndex(cards, { x: 200, y: 30 }, false)).toBe(2);
    expect(listPointerIndex(cards, { x: 10, y: 120 }, false)).toBe(2);
    expect(listPointerIndex(cards, { x: 200, y: 120 }, false)).toBe(4);
    expect(listPointerIndex(cards, { x: 10, y: 190 }, false)).toBe(4);
  });

  it('uses vertical midpoints for rows and accepts an empty list', () => {
    const rows = [cards[0], cards[2]];
    expect(listPointerIndex(rows, { x: 90, y: 10 }, true)).toBe(0);
    expect(listPointerIndex(rows, { x: 10, y: 70 }, true)).toBe(1);
    expect(listPointerIndex(rows, { x: 10, y: 150 }, true)).toBe(2);
    expect(listPointerIndex([], { x: 0, y: 0 }, true)).toBe(0);
  });
});
