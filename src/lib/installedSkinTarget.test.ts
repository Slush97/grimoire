import { expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { installedDoorStuckTarget, installedSkinPreviewTarget } from './installedSkinTarget';
import { movementFxSchema } from './movementFx';

const base: Mod = { id: 'base', name: 'Blackmore Academy Mina', metaKey: 'pak13_dir.vpk',
  path: '/addons/pak13_dir.vpk', fileName: 'pak13_dir.vpk', priority: 13, enabled: false,
  size: 100, installedAt: '', sha256: 'a'.repeat(64), lockerHero: 'Mina' };
const overlay: Mod = { ...base, id: 'overlay', name: 'Mina custom', metaKey: 'pak12_dir.vpk',
  priority: 12, enabled: true, sha256: 'b'.repeat(64), skinEdit: { hero: 'Mina', sources: [base.sha256 ?? ''] } };

it('opens enabled or disabled global movement effects without requiring a hero tag', () => {
  for (const kind of ['dash', 'heavy-melee']) {
    const choice = movementFxSchema.parse({ kind, color: '#abcdef', image: null });
    for (const enabled of [true, false]) {
      expect(installedDoorStuckTarget({ ...base, name: 'Custom effect', lockerHero: undefined, enabled, movementFx: choice }))
        .toEqual({ kind: 'movement', choice });
    }
  }
  expect(installedDoorStuckTarget(base)).toEqual({ heroName: 'Mina', skinSources: [{ metaKey: base.metaKey, priority: 13 }] });
  expect(installedDoorStuckTarget({ ...base, name: 'Unrelated effect', lockerHero: undefined })).toBeNull();
});

it('previews the overlay with its exact base, even if the base is disabled', () => {
  expect(installedSkinPreviewTarget(overlay, [base, overlay])).toEqual({ heroName: 'Mina', skinSources: [
    { metaKey: base.metaKey, priority: 13 }, { metaKey: overlay.metaKey, priority: 12 },
  ] });
});

it('does not quietly substitute vanilla for a missing or replaced source', () => {
  expect(installedSkinPreviewTarget(overlay, [overlay])).toBeNull();
  expect(installedSkinPreviewTarget(overlay, [{ ...base, sha256: 'c'.repeat(64) }, overlay])).toBeNull();
});

it('resolves nested sources once and refuses dependency cycles', () => {
  const nested = { ...overlay, id: 'nested', metaKey: 'pak11_dir.vpk', sha256: 'c'.repeat(64),
    skinEdit: { hero: 'Mina', sources: [overlay.sha256 ?? '', base.sha256 ?? ''] } };
  expect(installedSkinPreviewTarget(nested, [base, overlay, nested])?.skinSources).toHaveLength(3);
  expect(installedSkinPreviewTarget(overlay, [{ ...base, skinEdit: { hero: 'Mina', sources: [overlay.sha256 ?? ''] } }, overlay])).toBeNull();
});
