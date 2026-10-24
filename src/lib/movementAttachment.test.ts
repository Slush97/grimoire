import { describe, expect, it } from 'vitest';
import { bindMeleeAttachment, resolveMeleeAttachment } from './movementAttachment';
import type { FxDescriptor } from '../components/locker/fxDescriptor';

describe('gameplay melee attachments', () => {
  it('follows the hero bound ability and inheritance, including kicks', () => {
    const heroes = { hero_lash: { m_mapBoundAbilities: { ESlot_Weapon_Melee: 'lash' } },
      hero_vampirebat: { m_mapBoundAbilities: { ESlot_Weapon_Melee: 'mina' } } };
    const abilities = { lash: { _multibase: ['base'], m_strEffectsAttachName: 'palm_r' },
      mina: { _base: 'kick' }, kick: { m_strEffectsAttachName: 'sole_L' }, base: { m_strEffectsAttachName: 'palm_L' } };
    expect(resolveMeleeAttachment(heroes, abilities, ['lash'])).toBe('palm_r');
    expect(resolveMeleeAttachment(heroes, abilities, ['vampirebat'])).toBe('sole_L');
    expect(resolveMeleeAttachment(heroes, abilities, ['missing'])).toBeUndefined();
    expect(resolveMeleeAttachment(heroes, { lash: { _base: 'lash' } }, ['lash'])).toBeUndefined();
  });
  it('rebinds the charge CP throughout the tree without changing cached data or the origin CP', () => {
    const source: FxDescriptor = { name: 'charge', emitters: [], operators: [], initializers: [], renderers: [], children: [],
      controlPoints: [{ cp: 0, attachment: null, attachType: 'PATTACH_WORLDORIGIN', entity: 'self' },
        { cp: 1, attachment: 'palm_L', attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' }] };
    const input = { ...source, children: [source] };
    const bound = bindMeleeAttachment(input, 'palm_r');
    expect(bound.controlPoints[0]).toBe(source.controlPoints[0]);
    expect(bound.children[0].controlPoints[1].attachment).toBe('palm_r');
    expect(source.controlPoints[1].attachment).toBe('palm_L');
  });
});
