import type { GameBananaMod } from '../types/gamebanana';

export type BrowseSections = [string, ...string[]];

export function toggleBrowseSection(selected: BrowseSections, section: string): BrowseSections {
  if (!selected.includes(section)) return [...selected, section];
  const remaining = selected.filter((value) => value !== section);
  const [first, ...rest] = remaining;
  return first ? [first, ...rest] : selected;
}

export function browseModSection(mod: Pick<GameBananaMod, 'section' | 'profileUrl'>): string {
  if (mod.section) return mod.section;
  const path = mod.profileUrl.match(/\/(mods|sounds|wips)\//i)?.[1]?.toLowerCase();
  return path === 'sounds' ? 'Sound' : path === 'wips' ? 'Wip' : 'Mod';
}

export function browseModKey(mod: Pick<GameBananaMod, 'id' | 'section' | 'profileUrl'>): string {
  return `${browseModSection(mod)}:${mod.id}`;
}
