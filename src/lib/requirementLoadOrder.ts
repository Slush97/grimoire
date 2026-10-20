import type { GameBananaItemRef, ModRequirement } from '../types/gamebanana';
import type { Mod } from '../types/mod';
import { modLoadOrder } from './lockerUtils';
import { matchRequirement, modRequirementRefs, requirementKey } from './modRequirements';

export function installedRequirementOrder(source: GameBananaItemRef, item: ModRequirement, mods: readonly Mod[]): Mod[] {
  if (item.importance !== 'required' || item.state !== 'on') return [];
  const match = matchRequirement(item, mods);
  if (match.state !== 'enabled') return [];
  const enabled = mods.filter(mod => mod.enabled).sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
  const owner = enabled.find(mod => modRequirementRefs(mod).some(ref => requirementKey(ref) === requirementKey(source)));
  const required = enabled.find(mod => match.matches.some(hit => hit.modId === mod.id));
  if (!owner || !required || owner.id === required.id) return [];
  return [owner, required].sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
}
