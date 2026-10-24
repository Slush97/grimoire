import { parseGameBananaItemUrl, type GameBananaItemRef, type ModRequirement, type ModRequirementSnapshot, type ModRequirementSource } from '../types/gamebanana';
import type { Mod } from '../types/mod';

export type RequirementSource = ModRequirementSource | { localModId: string; name: string; requirements: ModRequirementSnapshot };
export type RequirementRef = GameBananaItemRef | Pick<Extract<RequirementSource, { localModId: string }>, 'localModId'>;
export const requirementKey = (item: RequirementRef): string => 'localModId' in item ? `local:${item.localModId}` : `${item.section}:${item.id}`;

export function skinRequirementSource(mod: Pick<Mod, 'id' | 'name' | 'skinEdit'>, mods: readonly RequirementMod[]): RequirementSource | null {
  if (!mod.skinEdit?.sources.length) return null;
  return { localModId: mod.id, name: mod.name, requirements: { status: 'loaded', checkedAt: 0,
    items: [...new Set(mod.skinEdit.sources)].map(sha256 => {
      const base = mods.find(candidate => candidate.sha256 === sha256);
      return { name: base?.name ?? sha256.slice(0, 12), sha256, importance: 'required', state: 'on',
        url: base?.gameBananaId ? `https://gamebanana.com/${base.sourceSection === 'Sound' ? 'sounds' : base.sourceSection === 'Wip' ? 'wips' : 'mods'}/${base.gameBananaId}` : undefined };
    }) } };
}

export function requirementSnapshot(source: RequirementRef, mods: readonly Mod[], snapshots: Readonly<Record<string, ModRequirementSnapshot>>): ModRequirementSnapshot | undefined {
  if (!('localModId' in source)) return snapshots[requirementKey(source)];
  const mod = mods.find(candidate => candidate.id === source.localModId);
  return mod ? skinRequirementSource(mod, mods)?.requirements : undefined;
}

export function requirementOwners(source: RequirementRef, mods: readonly Mod[]): Mod[] {
  return mods.filter(mod => 'localModId' in source ? mod.id === source.localModId
    : modRequirementRefs(mod).some(ref => requirementKey(ref) === requirementKey(source)));
}

export function parseRequirements(raw: unknown, checkedAt = Date.now()): ModRequirementSnapshot {
  if (raw === null) return { status: 'loaded', checkedAt, items: [] };
  if (!Array.isArray(raw)) return { status: 'unavailable', checkedAt };
  const items: ModRequirement[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || ![2, 4, 6].includes(row.length) || !row.every(v => typeof v === 'string')) {
      return { status: 'unavailable', checkedAt };
    }
    const name = row[0].trim();
    if (!name) return { status: 'unavailable', checkedAt };
    let url: string | undefined;
    try {
      const parsed = new URL(row[1]);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href;
    } catch { /* Text-only requirements have no URL. */ }
    // Most mods use GameBanana's simple [name, url] form, which carries no
    // state or importance; authors fill it with credits and recommendations.
    if (row.length === 2) {
      items.push({ name, url, state: 'on', importance: 'optional' });
      continue;
    }
    const state = row[2].toLowerCase();
    const importance = row[row.length === 6 ? 4 : 3].toLowerCase();
    items.push({ name, url,
      state: ['1', 'on', 'enabled'].includes(state) ? 'on' : ['off', 'disabled'].includes(state) ? 'off' : 'unknown',
      importance: importance === '7' || importance === 'required' ? 'required'
        : ['optional', 'recommended'].includes(importance) ? 'optional' : 'unknown',
    });
  }
  return { status: 'loaded', checkedAt, items };
}

export interface RequirementMatch { modId: string; name: string; enabled: boolean }
export type RequirementMod = Pick<Mod, 'id' | 'name' | 'enabled' | 'gameBananaId' | 'sourceSection' | 'merged' | 'sha256' | 'skinEdit'>;
export type RequirementState = 'enabled' | 'disabled' | 'missing' | 'met' | 'manual' | 'optional';
export function matchRequirement(item: ModRequirement, mods: readonly RequirementMod[]): { state: RequirementState; matches: RequirementMatch[] } {
  // Authors fill requirements with credits, notes and off-site tools, so only a
  // GameBanana item marked Required is checked. An unrecognised state label is
  // read as On, the usual meaning for a required mod.
  const target = item.importance === 'required' && item.url ? parseGameBananaItemUrl(item.url) : null;
  if (!target && !item.sha256) return { state: 'optional', matches: [] };
  const matches: RequirementMatch[] = [];
  for (const mod of mods) {
    const identities = [{ id: mod.gameBananaId, section: mod.sourceSection ?? 'Mod' },
      ...(mod.merged?.sources ?? []).map(s => ({ id: s.gameBananaId, section: s.section ?? 'Mod' }))];
    if (item.sha256 ? mod.sha256 === item.sha256 : target && identities.some(s => s.id === target.id && s.section === target.section)) {
      matches.push({ modId: mod.id, name: mod.name, enabled: mod.enabled });
    }
  }
  const enabled = matches.some(m => m.enabled);
  if (item.state === 'off') return { state: enabled ? 'manual' : 'met', matches };
  return { state: enabled ? 'enabled' : matches.length ? 'disabled' : 'missing', matches };
}

export function hasRequirementIssues(snapshot: ModRequirementSnapshot | undefined, mods: readonly Mod[]): boolean {
  if (!snapshot) return false;
  if (snapshot.status === 'unavailable') return false;
  return snapshot.items.some(item => ['disabled', 'missing', 'manual'].includes(matchRequirement(item, mods).state));
}

export function modRequirementRefs(mod: Pick<Mod, 'gameBananaId' | 'sourceSection' | 'merged'>): GameBananaItemRef[] {
  return [
    ...(mod.gameBananaId ? [{ id: mod.gameBananaId, section: mod.sourceSection ?? 'Mod' }] : []),
    ...(mod.merged?.sources ?? []).flatMap(s => s.gameBananaId ? [{ id: s.gameBananaId, section: s.section ?? 'Mod' }] : []),
  ].filter(target => ['Mod', 'Sound', 'Wip'].includes(target.section));
}
