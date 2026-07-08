import { describe, expect, it } from 'vitest';
import { parseGameBananaItemUrl } from './gamebanana';

describe('parseGameBananaItemUrl', () => {
  it('parses standard mod / sound / wip item pages', () => {
    expect(parseGameBananaItemUrl('https://gamebanana.com/mods/610813')).toEqual({
      id: 610813,
      section: 'Mod',
    });
    expect(parseGameBananaItemUrl('https://www.gamebanana.com/sounds/12345')).toEqual({
      id: 12345,
      section: 'Sound',
    });
    expect(parseGameBananaItemUrl('http://gamebanana.com/wips/99')).toEqual({
      id: 99,
      section: 'Wip',
    });
  });

  it('accepts protocol-relative URLs and ignores query/hash', () => {
    expect(parseGameBananaItemUrl('//gamebanana.com/mods/690548?ref=desc#top')).toEqual({
      id: 690548,
      section: 'Mod',
    });
  });

  it('rejects non-item GameBanana paths (open externally)', () => {
    expect(parseGameBananaItemUrl('https://gamebanana.com/members/123')).toBeNull();
    expect(parseGameBananaItemUrl('https://gamebanana.com/collections/164637')).toBeNull();
    expect(parseGameBananaItemUrl('https://gamebanana.com/dl/1392011')).toBeNull();
    expect(parseGameBananaItemUrl('https://gamebanana.com/mods/download/690548')).toBeNull();
    expect(parseGameBananaItemUrl('https://gamebanana.com/mods/cats/33295')).toBeNull();
    expect(parseGameBananaItemUrl('https://gamebanana.com/tools/1')).toBeNull();
  });

  it('rejects non-GameBanana hosts and empty input', () => {
    expect(parseGameBananaItemUrl('https://example.com/mods/1')).toBeNull();
    expect(parseGameBananaItemUrl('https://evilgamebanana.com/mods/1')).toBeNull();
    expect(parseGameBananaItemUrl('')).toBeNull();
    expect(parseGameBananaItemUrl('not a url')).toBeNull();
  });
});
