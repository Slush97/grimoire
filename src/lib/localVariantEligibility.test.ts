import { describe, expect, it } from 'vitest';
import type { MergedModInfo, Mod } from '../types/mod';
import {
  canJoinLocalVariantGroup,
  installedVariantGroupKey,
  localVariantSelectionEligibility,
} from './localVariantEligibility';

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

const merged: MergedModInfo = {
  id: 'merge-1',
  createdAt: '2026-01-01T00:00:00Z',
  shareCode: 'mp1:recover-me',
  sources: [],
};

describe('canJoinLocalVariantGroup', () => {
  it('accepts ordinary local mods', () => {
    expect(canJoinLocalVariantGroup(mod({ id: 'local' }))).toBe(true);
  });

  it('rejects merged outputs using the same rule as Add variant', () => {
    expect(canJoinLocalVariantGroup(mod({ id: 'merged', merged }))).toBe(false);
  });

  it('rejects GameBanana mods', () => {
    expect(canJoinLocalVariantGroup(mod({ id: 'remote', gameBananaId: 42 }))).toBe(false);
  });

  it('keeps an explicit local group editable after it adopts GameBanana provenance', () => {
    expect(
      canJoinLocalVariantGroup(
        mod({ id: 'adopted', gameBananaId: 42, localGroupId: 'local-group' })
      )
    ).toBe(true);
  });

  it('ignores a non-positive GameBanana marker like the main-process policy', () => {
    expect(canJoinLocalVariantGroup(mod({ id: 'invalid-remote', gameBananaId: 0 }))).toBe(true);
  });
});

describe('localVariantSelectionEligibility', () => {
  it('requires at least two selected mods', () => {
    expect(localVariantSelectionEligibility([])).toEqual({
      eligible: false,
      reason: 'minimum',
    });
    expect(localVariantSelectionEligibility([mod({ id: 'only' })])).toEqual({
      eligible: false,
      reason: 'minimum',
    });
  });

  it('allows two or more ordinary local mods', () => {
    expect(
      localVariantSelectionEligibility([mod({ id: 'one' }), mod({ id: 'two' })])
    ).toEqual({ eligible: true });
  });

  it('rejects a selection containing a merged output', () => {
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'local' }),
        mod({ id: 'merged', merged }),
      ])
    ).toEqual({ eligible: false, reason: 'merged' });
  });

  it('reports merged before GameBanana for a mixed unsafe selection', () => {
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'merged', merged }),
        mod({ id: 'remote', gameBananaId: 42 }),
      ])
    ).toEqual({ eligible: false, reason: 'merged' });
  });

  it('rejects a selection containing a GameBanana mod', () => {
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'local' }),
        mod({ id: 'remote', gameBananaId: 42 }),
      ])
    ).toEqual({ eligible: false, reason: 'gamebanana' });
  });

  it('rejects mixed Global priority-folder placement like the main-process planner', () => {
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'global', priorityMod: true }),
        mod({ id: 'plain' }),
      ])
    ).toEqual({ eligible: false, reason: 'placement' });
  });

  it('rejects two definite but different Locker classifications', () => {
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'ivy', lockerHero: 'Ivy' }),
        mod({ id: 'geist', lockerHero: 'Lady Geist' }),
      ])
    ).toEqual({ eligible: false, reason: 'classification' });
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'hud', globalType: 'hud' }),
        mod({ id: 'ivy', lockerHero: 'Ivy' }),
      ])
    ).toEqual({ eligible: false, reason: 'classification' });
  });

  it('lets an unclassified mod inherit a classified peer, matching hero case-insensitively', () => {
    expect(
      localVariantSelectionEligibility([
        mod({ id: 'ivy', lockerHero: 'Ivy' }),
        mod({ id: 'ivy2', lockerHero: 'ivy ' }),
        mod({ id: 'unclassified' }),
      ])
    ).toEqual({ eligible: true });
  });
});

describe('installedVariantGroupKey', () => {
  it('keeps normal local variants grouped', () => {
    expect(installedVariantGroupKey(mod({ id: 'local', localGroupId: 'group-1' }))).toBe(
      'local:group-1'
    );
  });

  it('keeps ordinary GameBanana variants grouped', () => {
    expect(installedVariantGroupKey(mod({ id: 'remote', gameBananaId: 42 }))).toBe('gb:42');
  });

  it('isolates a legacy merged output even when it carries a local group id', () => {
    expect(
      installedVariantGroupKey(mod({ id: 'merged', localGroupId: 'group-1', merged }))
    ).toBeNull();
  });
});
