import { parseGameBananaItemUrl, type GameBananaItemRef, type ModRequirement, type ModRequirementSnapshot } from '../types/gamebanana';
import type { Mod } from '../types/mod';

export const requirementKey = (item: GameBananaItemRef): string => `${item.section}:${item.id}`;

export function parseRequirements(raw: unknown, checkedAt = Date.now()): ModRequirementSnapshot {
  if (raw === null) return { status: 'loaded', checkedAt, items: [] };
  if (!Array.isArray(raw)) return { status: 'unavailable', checkedAt };
  const items: ModRequirement[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || (row.length !== 4 && row.length !== 6) || !row.every(v => typeof v === 'string')) {
      return { status: 'unavailable', checkedAt };
    }
    const name = row[0].trim();
    if (!name) return { status: 'unavailable', checkedAt };
    let url: string | undefined;
    try {
      const parsed = new URL(row[1]);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href;
    } catch { /* Text-only requirements have no URL. */ }
    const state = row[2].toLowerCase();
    const importance = row[row.length === 6 ? 4 : 3].toLowerCase();
    items.push({ name, url,
      state: state === '1' || state === 'on' ? 'on' : state === 'off' ? 'off' : 'unknown',
      importance: importance === '7' || importance === 'required' ? 'required'
        : ['optional', 'recommended'].includes(importance) ? 'optional' : 'unknown',
    });
  }
  return { status: 'loaded', checkedAt, items };
}

export interface RequirementMatch { modId: string; name: string; enabled: boolean }
export type RequirementMod = Pick<Mod, 'id' | 'name' | 'enabled' | 'gameBananaId' | 'sourceSection' | 'merged'>;
export type RequirementState = 'enabled' | 'disabled' | 'missing' | 'met' | 'manual' | 'optional';
export function matchRequirement(item: ModRequirement, mods: readonly RequirementMod[]): { state: RequirementState; matches: RequirementMatch[] } {
  if (item.importance === 'optional') return { state: 'optional', matches: [] };
  const target = item.url ? parseGameBananaItemUrl(item.url) : null;
  if (!target || item.importance === 'unknown' || item.state === 'unknown') return { state: 'manual', matches: [] };
  const matches: RequirementMatch[] = [];
  for (const mod of mods) {
    const identities = [{ id: mod.gameBananaId, section: mod.sourceSection ?? 'Mod' },
      ...(mod.merged?.sources ?? []).map(s => ({ id: s.gameBananaId, section: s.section ?? 'Mod' }))];
    if (identities.some(s => s.id === target.id && s.section === target.section)) {
      matches.push({ modId: mod.id, name: mod.name, enabled: mod.enabled });
    }
  }
  const enabled = matches.some(m => m.enabled);
  if (item.state === 'off') return { state: enabled ? 'manual' : 'met', matches };
  return { state: enabled ? 'enabled' : matches.length ? 'disabled' : 'missing', matches };
}

export function hasRequirementIssues(snapshot: ModRequirementSnapshot | undefined, mods: readonly Mod[]): boolean {
  if (!snapshot) return false;
  if (snapshot.status === 'unavailable') return true;
  return snapshot.items.some(item => ['disabled', 'missing', 'manual'].includes(matchRequirement(item, mods).state));
}

export function modRequirementRefs(mod: Pick<Mod, 'gameBananaId' | 'sourceSection' | 'merged'>): GameBananaItemRef[] {
  return [
    ...(mod.gameBananaId ? [{ id: mod.gameBananaId, section: mod.sourceSection ?? 'Mod' }] : []),
    ...(mod.merged?.sources ?? []).flatMap(s => s.gameBananaId ? [{ id: s.gameBananaId, section: s.section ?? 'Mod' }] : []),
  ].filter(target => ['Mod', 'Sound', 'Wip'].includes(target.section));
}
