import { describe, expect, it } from 'vitest';
import { selectEntryRange, type SelectionEntry } from './selection';

const entries: SelectionEntry[] = [
  { key: 'talon', ids: ['talon'] },
  { key: 'variants', ids: ['variant-a', 'variant-b'] },
  { key: 'mcginnis', ids: ['mcginnis'] },
  { key: 'other', ids: ['other'] },
];

describe('installed range selection', () => {
  it('selects an inclusive range and all grouped variants, preserving other selections', () => {
    expect(selectEntryRange(new Set(['talon', 'other']), entries, 'talon', entries[2], true))
      .toEqual(new Set(['talon', 'variant-a', 'variant-b', 'mcginnis', 'other']));
  });

  it('selects a range backwards in the displayed order', () => {
    expect(selectEntryRange(new Set(['mcginnis']), entries, 'mcginnis', entries[0], true))
      .toEqual(new Set(['talon', 'variant-a', 'variant-b', 'mcginnis']));
  });

  it('deselects an inclusive range and grouped variants without clearing other selections', () => {
    const selected = new Set(entries.flatMap((entry) => entry.ids));
    expect(selectEntryRange(selected, entries, 'talon', entries[2], true))
      .toEqual(new Set(['other']));
    expect(selectEntryRange(selected, entries, 'mcginnis', entries[0], true))
      .toEqual(new Set(['other']));
  });

  it('selects a partially selected target group instead of removing the range', () => {
    expect(selectEntryRange(new Set(['talon', 'variant-a']), entries, 'talon', entries[1], true))
      .toEqual(new Set(['talon', 'variant-a', 'variant-b']));
  });

  it('only includes displayed entries after filtering or collapsing a section', () => {
    expect(selectEntryRange(new Set(['talon']), [entries[0], entries[2]], 'talon', entries[2], true))
      .toEqual(new Set(['talon', 'mcginnis']));
  });

  it('falls back to an ordinary toggle when the anchor is absent', () => {
    expect(selectEntryRange(new Set(), entries, 'hidden', entries[2], true))
      .toEqual(new Set(['mcginnis']));
  });

  it('toggles whole groups on ordinary clicks, including partially selected groups', () => {
    const selected = selectEntryRange(new Set(['variant-a']), entries, null, entries[1], false);
    expect(selected).toEqual(new Set(['variant-a', 'variant-b']));
    expect(selectEntryRange(selected, entries, null, entries[1], false)).toEqual(new Set());
  });
});
