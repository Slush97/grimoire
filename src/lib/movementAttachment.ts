import { z } from 'zod';
import type { FxDescriptor } from '../components/locker/fxDescriptor';

const table = z.record(z.unknown());
const heroSchema = z.object({ m_mapBoundAbilities: z.record(z.string()).optional() });
const abilitySchema = z.object({
  m_strEffectsAttachName: z.string().optional(),
  _base: z.string().optional(), _multibase: z.array(z.string()).optional(),
});

/** Gameplay bindings override the generic particle editor mannequin's palm. */
export function resolveMeleeAttachment(heroesInput: unknown, abilitiesInput: unknown, codenames: readonly string[]): string | undefined {
  const heroes = table.parse(heroesInput), abilities = table.parse(abilitiesInput);
  const visited = new Set<string>();
  const attachment = (name: string): string | undefined => {
    if (visited.has(name) || visited.size >= 32 || !abilities[name]) return undefined;
    visited.add(name);
    const ability = abilitySchema.parse(abilities[name]);
    if (ability.m_strEffectsAttachName) return ability.m_strEffectsAttachName;
    for (const base of [...(ability._multibase ?? []), ...(ability._base ? [ability._base] : [])].reverse()) {
      const value = attachment(base);
      if (value) return value;
    }
    return undefined;
  };
  for (const codename of codenames) {
    const raw = heroes[`hero_${codename}`];
    if (!raw) continue;
    const name = heroSchema.parse(raw).m_mapBoundAbilities?.ESlot_Weapon_Melee;
    if (name) return attachment(name);
  }
  return undefined;
}

export function bindMeleeAttachment(descriptor: FxDescriptor, attachment: string): FxDescriptor {
  return { ...descriptor,
    controlPoints: descriptor.controlPoints.map(point => point.cp === 1
      ? { ...point, attachment, attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' } : point),
    children: descriptor.children.map(child => bindMeleeAttachment(child, attachment)),
  };
}
