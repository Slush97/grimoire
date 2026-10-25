import { describe, expect, it } from 'vitest';
import { readModListDrag } from './modListDrag';

describe('list drag payloads', () => {
  it('keeps mod membership and list reordering as distinct operations', () => {
    expect(readModListDrag('{"kind":"entry","key":"gamebanana:1"}')).toEqual({ kind: 'entry', key: 'gamebanana:1' });
    expect(readModListDrag('{"kind":"list","id":"skins"}')).toEqual({ kind: 'list', id: 'skins' });
  });

  it('ignores malformed, unrelated and incomplete drops', () => {
    for (const raw of ['', 'file:///a.vpk', 'null', '[]', '{}', '{"kind":"entry","key":1}', '{"kind":"list","id":""}', '{"kind":"reorder-mods","ids":[1]}']) {
      expect(readModListDrag(raw)).toBeNull();
    }
  });
});
