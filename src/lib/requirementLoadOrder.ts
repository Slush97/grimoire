import type { ModRequirement, ModRequirementSnapshot } from '../types/gamebanana';
import type { Mod } from '../types/mod';
import { modLoadOrder } from './lockerUtils';
import { matchRequirement, modRequirementRefs, requirementKey, requirementOwners, skinRequirementSource, type RequirementRef } from './modRequirements';

export function installedRequirementOrder(source: RequirementRef, item: ModRequirement, mods: readonly Mod[]): Mod[] {
  if (item.importance !== 'required' || item.state !== 'on') return [];
  const match = matchRequirement(item, mods);
  if (match.state !== 'enabled') return [];
  const enabled = mods.filter(mod => mod.enabled).sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
  const owner = requirementOwners(source, enabled)[0];
  const required = enabled.find(mod => match.matches.some(hit => hit.modId === mod.id));
  if (!owner || !required || owner.id === required.id) return [];
  return [owner, required].sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
}

export const requirementFileKey = (mod: Mod): string => JSON.stringify([mod.path, mod.size, mod.sha256, mod.installedAt]);
export type RequirementFileLists = Readonly<Record<string, readonly string[] | null>>;
export interface RequirementOrderIssue {
  source: RequirementRef;
  overlay: Mod;
  base: Mod;
  fixable: boolean;
}

export function requirementOrderCandidates(mods: readonly Mod[], snapshots: Readonly<Record<string, ModRequirementSnapshot>>): Mod[] {
  const candidates = new Map<string, Mod>();
  for (const mod of mods) {
    if (!mod.enabled) continue;
    const local = skinRequirementSource(mod, mods);
    if (local?.requirements.status === 'loaded') {
      for (const item of local.requirements.items) {
        for (const hit of matchRequirement(item, mods).matches) {
          const base = mods.find(candidate => candidate.id === hit.modId && candidate.enabled && candidate.id !== mod.id);
          if (base) { candidates.set(mod.id, mod); candidates.set(base.id, base); }
        }
      }
    }
    for (const source of modRequirementRefs(mod)) {
      const snapshot = snapshots[requirementKey(source)];
      if (snapshot?.status !== 'loaded') continue;
      for (const item of snapshot.items) {
        if (item.importance !== 'required' || item.state !== 'on') continue;
        const match = matchRequirement(item, mods);
        for (const hit of match.matches) {
          const base = mods.find(candidate => candidate.id === hit.modId && candidate.enabled && candidate.id !== mod.id);
          if (base) { candidates.set(mod.id, mod); candidates.set(base.id, base); }
        }
      }
    }
  }
  return [...candidates.values()];
}

export function isTextureOverlay(overlay: readonly string[], base: readonly string[]): boolean {
  const resources = overlay.map(path => path.toLowerCase().replaceAll('\\', '/')).filter(path => !['addoninfo.txt', 'grimoire_meta.json', 'readme.txt', 'readme.md', 'license', 'license.txt'].includes(path));
  const basePaths = new Set(base.map(path => path.toLowerCase().replaceAll('\\', '/')));
  return resources.length > 0 && resources.some(path => path.endsWith('.vtex_c')) &&
    resources.every(path => /\.(vtex|vmat)_c$/.test(path) && basePaths.has(path)) &&
    [...basePaths].some(path => path.endsWith('.vmdl_c'));
}

export function requirementOrderIssues(source: RequirementRef, snapshot: ModRequirementSnapshot | undefined, mods: readonly Mod[], files: RequirementFileLists): RequirementOrderIssue[] {
  if (snapshot?.status !== 'loaded') return [];
  const issues: RequirementOrderIssue[] = [];
  const owners = requirementOwners(source, mods).filter(mod => mod.enabled);
  for (const item of snapshot.items) {
    if (item.importance !== 'required' || item.state === 'off') continue;
    const matches = matchRequirement(item, mods).matches;
    const bases = mods.filter(mod => mod.enabled && matches.some(hit => hit.modId === mod.id)).sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
    for (const overlay of owners) {
      const base = bases.find(candidate => candidate.id !== overlay.id);
      if (!base || matches.some(hit => hit.modId === overlay.id) || modLoadOrder(overlay) <= modLoadOrder(base)) continue;
      const overlayFiles = files[requirementFileKey(overlay)];
      const baseFiles = files[requirementFileKey(base)];
      if (overlayFiles && baseFiles && isTextureOverlay(overlayFiles, baseFiles)) {
        issues.push({ source, overlay, base, fixable: !base.priorityMod && !base.metaKey.startsWith('grimoire/') });
      }
    }
  }
  return issues;
}

export function moveRequirementAboveBase(mods: readonly Mod[], overlayId: string, baseId: string): string[] | null {
  const enabled = mods.filter(mod => mod.enabled).sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
  const overlay = enabled.find(mod => mod.id === overlayId);
  const base = enabled.find(mod => mod.id === baseId);
  if (!overlay || !base || overlay.id === base.id || base.priorityMod || base.metaKey.startsWith('grimoire/')) return null;
  const order = enabled.filter(mod => mod.id !== overlayId).map(mod => mod.id);
  order.splice(order.indexOf(baseId), 0, overlayId);
  return order;
}
