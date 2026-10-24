import { canonicalHeroName, inferHeroFromTitle, isLockerManagedMod } from './lockerUtils';
import type { Mod } from '../types/mod';
import type { SkinEditSource } from '../types/skinEditor';

export function installedSkinTarget(mod: Mod): SkinEditSource | null {
  if (!isLockerManagedMod(mod)) return null;
  const heroName = canonicalHeroName(mod.skinEdit?.hero ?? mod.lockerHero ?? inferHeroFromTitle(mod.name) ?? '');
  if (!heroName) return null;
  return { heroName, skinSources: [{ metaKey: mod.metaKey, priority: mod.priority }] };
}

/** A saved material overlay is only meaningful together with its original skins. */
export function installedSkinPreviewTarget(mod: Mod, mods: readonly Mod[]): SkinEditSource | null {
  const target = installedSkinTarget(mod);
  if (!target) return null;
  const stack = new Map<string, Mod>();
  const visiting = new Set<string>();
  const collect = (current: Mod): boolean => {
    if (visiting.has(current.id)) return false;
    if (stack.has(current.id)) return true;
    visiting.add(current.id);
    for (const hash of current.skinEdit?.sources ?? []) {
      const base = mods.find(candidate => candidate.sha256 === hash && candidate.enabled)
        ?? mods.find(candidate => candidate.sha256 === hash);
      if (!base || !collect(base)) return false;
    }
    visiting.delete(current.id);
    stack.set(current.id, current);
    return true;
  };
  if (!collect(mod)) return null;
  return { ...target, skinSources: [...stack.values()].map(source => ({ metaKey: source.metaKey, priority: source.priority })) };
}
