import { canonicalHeroName, inferHeroFromTitle, isLockerManagedMod } from './lockerUtils';
import type { Mod } from '../types/mod';
import type { SkinEditSource } from '../types/skinEditor';

export function installedSkinTarget(mod: Mod): SkinEditSource | null {
  if (!isLockerManagedMod(mod)) return null;
  const heroName = canonicalHeroName(mod.skinEdit?.hero ?? mod.lockerHero ?? inferHeroFromTitle(mod.name) ?? '');
  if (!heroName) return null;
  return { heroName, skinSources: [{ metaKey: mod.metaKey, priority: mod.priority }] };
}
