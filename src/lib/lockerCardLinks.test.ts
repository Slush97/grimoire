import { describe, it, expect } from 'vitest';
import {
  lockerLinkKey,
  planLinkedCards,
  selectionsSignature,
  upsertLink,
  withoutHero,
  withoutSkin,
  type ActiveSkin,
} from './lockerCardLinks';
import type { LockerCardLink, LockerCardSelection } from '../types/mod';

const NOW = '2026-07-30T00:00:00.000Z';

function link(over: Partial<LockerCardLink> = {}): LockerCardLink {
  return {
    skinKey: 'gamebanana:111',
    skinName: 'Ralsei Rem',
    heroName: 'Rem',
    heroCodename: 'familiar',
    sourceKey: 'pak04_dir.vpk',
    sourceModName: 'Ralsei Rem Toasted Compatibility Icons',
    sourceSha256: 'abc',
    variants: ['card', 'mm'],
    linkedAt: NOW,
    ...over,
  };
}

function manual(over: Partial<LockerCardSelection> = {}): LockerCardSelection {
  return {
    heroCodename: 'hornet',
    heroName: 'Vindicta',
    variants: ['card'],
    source: { kind: 'mod', fileName: 'pak09_dir.vpk', sha256AtApplyTime: 'zzz' },
    origin: 'manual',
    addedAt: NOW,
    ...over,
  };
}

const active = (...keys: string[]): ActiveSkin[] =>
  keys.map((key, i) => ({ key, loadOrder: i + 1 }));

describe('lockerLinkKey', () => {
  it('prefers the GameBanana id so the key survives pakNN renames', () => {
    expect(lockerLinkKey({ id: 'md5a', gameBananaId: 680646, sha256: 'aa' })).toBe(
      'gamebanana:680646'
    );
  });

  it('falls back to content hash for local imports', () => {
    expect(lockerLinkKey({ id: 'md5a', sha256: 'deadbeef' })).toBe('sha256:deadbeef');
  });

  it('falls back to the mod id only when there is no stable identity', () => {
    expect(lockerLinkKey({ id: 'md5a' })).toBe('mod:md5a');
  });

  it('ignores a zero/negative GameBanana id', () => {
    expect(lockerLinkKey({ id: 'md5a', gameBananaId: 0, sha256: 'bb' })).toBe('sha256:bb');
  });

  it('is stable across the rename a toggle causes (id changes, key does not)', () => {
    const before = lockerLinkKey({ id: 'md5-pak07', gameBananaId: 42 });
    const after = lockerLinkKey({ id: 'md5-pak12', gameBananaId: 42 });
    expect(before).toBe(after);
  });
});

describe('planLinkedCards', () => {
  it('applies a linked icon when its skin is enabled', () => {
    const next = planLinkedCards({
      links: [link()],
      current: [],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      heroCodename: 'familiar',
      origin: 'link',
      linkedSkinKey: 'gamebanana:111',
      source: { fileName: 'pak04_dir.vpk', sha256AtApplyTime: 'abc' },
    });
  });

  it('applies nothing when the linked skin is disabled', () => {
    const next = planLinkedCards({
      links: [link()],
      current: [],
      activeSkins: [],
      now: NOW,
    });
    expect(next).toEqual([]);
  });

  it('drops the link selection when its skin is turned off', () => {
    const applied = planLinkedCards({
      links: [link()],
      current: [],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    const reverted = planLinkedCards({
      links: [link()],
      current: applied,
      activeSkins: [],
      now: NOW,
    });
    expect(reverted).toEqual([]);
  });

  it('keeps manual selections for other heroes untouched', () => {
    const next = planLinkedCards({
      links: [link()],
      current: [manual()],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    expect(next).toHaveLength(2);
    expect(next.find((s) => s.heroCodename === 'hornet')).toEqual(manual());
  });

  it('keeps a custom upload for another hero untouched', () => {
    const custom = manual({
      heroCodename: 'lash',
      heroName: 'Lash',
      origin: undefined,
      source: { kind: 'custom', fileName: 'custom:lash', sha256AtApplyTime: '' },
    });
    const next = planLinkedCards({
      links: [link()],
      current: [custom],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    expect(next.find((s) => s.heroCodename === 'lash')).toEqual(custom);
  });

  it('never clobbers a manual pick for the SAME hero', () => {
    const manualRem = manual({ heroCodename: 'familiar', heroName: 'Rem' });
    const next = planLinkedCards({
      links: [link()],
      current: [manualRem],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    expect(next).toEqual([manualRem]);
  });

  it('treats a legacy selection with no origin as manual and leaves it alone', () => {
    const legacy = manual({ heroCodename: 'familiar', heroName: 'Rem', origin: undefined });
    const next = planLinkedCards({
      links: [link()],
      current: [legacy],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    expect(next).toEqual([legacy]);
  });

  it('resolves two enabled linked skins for one hero by load order', () => {
    const loser = link({ skinKey: 'gamebanana:111', sourceKey: 'loser.vpk' });
    const winner = link({ skinKey: 'gamebanana:222', sourceKey: 'winner.vpk' });
    const next = planLinkedCards({
      links: [loser, winner],
      current: [],
      activeSkins: [
        { key: 'gamebanana:222', loadOrder: 3 },
        { key: 'gamebanana:111', loadOrder: 9 },
      ],
      now: NOW,
    });
    expect(next).toHaveLength(1);
    expect(next[0].source.fileName).toBe('winner.vpk');
  });

  it('uses the lowest load order when a skin has several enabled variant VPKs', () => {
    const next = planLinkedCards({
      links: [link(), link({ skinKey: 'gamebanana:222', sourceKey: 'other.vpk' })],
      current: [],
      activeSkins: [
        { key: 'gamebanana:111', loadOrder: 12 },
        { key: 'gamebanana:111', loadOrder: 4 },
        { key: 'gamebanana:222', loadOrder: 8 },
      ],
      now: NOW,
    });
    expect(next.map((s) => s.source.fileName)).toEqual(['pak04_dir.vpk']);
  });

  it('applies links for different heroes side by side', () => {
    const next = planLinkedCards({
      links: [link(), link({ skinKey: 'gamebanana:222', heroCodename: 'lash', heroName: 'Lash' })],
      current: [],
      activeSkins: active('gamebanana:111', 'gamebanana:222'),
      now: NOW,
    });
    expect(next.map((s) => s.heroCodename).sort()).toEqual(['familiar', 'lash']);
  });

  it('preserves addedAt for an already-applied link so unrelated toggles are no-ops', () => {
    const applied = planLinkedCards({
      links: [link()],
      current: [],
      activeSkins: active('gamebanana:111'),
      now: '2026-01-01T00:00:00.000Z',
    });
    const again = planLinkedCards({
      links: [link()],
      current: applied,
      activeSkins: active('gamebanana:111'),
      now: '2026-09-09T00:00:00.000Z',
    });
    expect(again[0].addedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(selectionsSignature(again)).toBe(selectionsSignature(applied));
  });

  it('re-points a hero when the link swaps to a different icon source', () => {
    const applied = planLinkedCards({
      links: [link()],
      current: [],
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    const swapped = planLinkedCards({
      links: [link({ sourceKey: 'pak22_dir.vpk' })],
      current: applied,
      activeSkins: active('gamebanana:111'),
      now: NOW,
    });
    expect(swapped[0].source.fileName).toBe('pak22_dir.vpk');
    expect(selectionsSignature(swapped)).not.toBe(selectionsSignature(applied));
  });
});

describe('selectionsSignature', () => {
  it('is order independent', () => {
    const a = manual();
    const b = manual({ heroCodename: 'lash', heroName: 'Lash' });
    expect(selectionsSignature([a, b])).toBe(selectionsSignature([b, a]));
  });

  it('distinguishes a manual pick from a link on the same source', () => {
    const asManual = manual({ heroCodename: 'familiar' });
    const asLink = manual({
      heroCodename: 'familiar',
      origin: 'link',
      linkedSkinKey: 'gamebanana:111',
    });
    expect(selectionsSignature([asManual])).not.toBe(selectionsSignature([asLink]));
  });
});

describe('link set edits', () => {
  it('upsert replaces a prior binding for the same skin', () => {
    const next = upsertLink([link()], link({ sourceKey: 'new.vpk' }));
    expect(next).toHaveLength(1);
    expect(next[0].sourceKey).toBe('new.vpk');
  });

  it('upsert replaces another skin binding for the same hero (one owner per hero)', () => {
    const next = upsertLink([link()], link({ skinKey: 'gamebanana:999', sourceKey: 'new.vpk' }));
    expect(next).toHaveLength(1);
    expect(next[0].skinKey).toBe('gamebanana:999');
  });

  it('upsert leaves bindings for other heroes alone', () => {
    const other = link({ skinKey: 'gamebanana:222', heroCodename: 'lash', heroName: 'Lash' });
    const next = upsertLink([other], link());
    expect(next).toHaveLength(2);
  });

  it('withoutHero clears every binding that owns the hero', () => {
    expect(withoutHero([link(), link({ skinKey: 'gamebanana:222' })], 'familiar')).toEqual([]);
  });

  it('withoutSkin clears only that skin binding', () => {
    const other = link({ skinKey: 'gamebanana:222', heroCodename: 'lash' });
    expect(withoutSkin([link(), other], 'gamebanana:111')).toEqual([other]);
  });
});
