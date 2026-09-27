import type { Mod, GlobalModType } from '../types/mod';
import { inferHeroFromTitle, canonicalHeroName, GLOBAL_MOD_TYPE_LABELS, getEffectiveGlobalType, modLoadOrder } from './lockerUtils';
import { installedVariantGroupKey } from './localVariantEligibility';
import { modPreferenceKey } from './disabledModPrefs';
import { heroNameForLabel } from './heroNames';

/**
 * Rows on the Installed page are either standalone mods or grouped files that
 * are variants of one mod (e.g. five preset VPKs from one skin pack, whether
 * they came from a GameBanana submission or a locally imported archive).
 * Grouped entries collapse to a single card; the picker modal handles
 * per-file enable, rename, and delete actions.
 */
export type ModEntry =
  | { kind: 'single'; mod: Mod; key: string }
  | {
      kind: 'group';
      /** Shared grouping key from variantGroupKey ("gb:123" / "local:<uuid>").
       *  The stable identity of the group across reconciles. */
      groupKey: string;
      /** Set only for GameBanana groups. Absent on local groups, which have no
       *  mod page to open and nothing to check for updates. */
      gameBananaId?: number;
      variants: Mod[];
      /** Enabled files in this group. Empty when the whole group is disabled. */
      enabledVariants: Mod[];
      /** First enabled variant in priority order, or null when every variant is disabled. */
      active: Mod | null;
      /** Mod we render visuals from (thumbnail, name, category). The first
       *  enabled file when any are enabled, else the first variant by priority. */
      primary: Mod;
      /** Sum of variant sizes — shown as the card's "size" field. */
      totalSize: number;
      key: string;
    };

function modEntryKey(mod: Mod): string {
  if (typeof mod.gameBananaId === 'number' && typeof mod.gameBananaFileId === 'number') {
    return `single:gb:${mod.gameBananaId}:${mod.gameBananaFileId}`;
  }
  if (mod.sha256) {
    return `single:sha:${mod.sha256}`;
  }
  return `single:local:${mod.name}:${mod.size}`;
}

export function buildModEntries(mods: Mod[]): ModEntry[] {
  const byGroup = new Map<string, Mod[]>();
  const singles: Mod[] = [];
  for (const m of mods) {
    const groupKey = installedVariantGroupKey(m);
    if (groupKey) {
      const arr = byGroup.get(groupKey) ?? [];
      arr.push(m);
      byGroup.set(groupKey, arr);
    } else {
      singles.push(m);
    }
  }
  // Singletons (only one mod for a given group key) collapse back to single
  // entries: the group concept only matters when there are 2+ variants.
  for (const [groupKey, variants] of Array.from(byGroup.entries())) {
    if (variants.length === 1) {
      singles.push(variants[0]);
      byGroup.delete(groupKey);
    }
  }

  const entries: ModEntry[] = [];
  // The base key is content-derived (sha/gb) so a card keeps its React + dnd
  // identity across reconciles that churn a mod's id (file renames, overflow
  // moves). But two physically distinct installs can share the same content
  // (same VPK installed twice => same sha), which collides the key. Detect
  // those groups up front and disambiguate every member with its unique id, so
  // the suffix is deterministic regardless of array order while single-install
  // mods keep the bare content key.
  const baseKeyCounts = new Map<string, number>();
  for (const m of singles) {
    const base = modEntryKey(m);
    baseKeyCounts.set(base, (baseKeyCounts.get(base) ?? 0) + 1);
  }
  for (const m of singles) {
    const base = modEntryKey(m);
    const key = (baseKeyCounts.get(base) ?? 0) > 1 ? `${base}#${m.id}` : base;
    entries.push({ kind: 'single', mod: m, key });
  }
  for (const [groupKey, variants] of byGroup) {
    // Sort variants by current priority so drag-reorder lines up with the
    // user's mental model ("which slot is this in?") and the picker shows
    // them in the same order as the addons folder.
    variants.sort((a, b) => a.priority - b.priority);
    const enabledVariants = variants.filter((v) => v.enabled);
    const active = enabledVariants[0] ?? null;
    const primary = enabledVariants[0] ?? variants[0];
    const totalSize = variants.reduce((sum, v) => sum + v.size, 0);
    // Preserve primary provenance for mod-page affordances. Whether membership
    // is user-managed comes from the authoritative group key, not this id: an
    // explicit local group may legitimately contain an adopted GameBanana VPK.
    const gameBananaId =
      typeof primary.gameBananaId === 'number' && primary.gameBananaId > 0
        ? primary.gameBananaId
        : undefined;
    entries.push({
      kind: 'group',
      groupKey,
      gameBananaId,
      variants,
      enabledVariants,
      active,
      primary,
      totalSize,
      key: `group:${groupKey}`,
    });
  }
  return entries;
}

/** A group is considered "enabled" when at least one file is enabled. */
export function isEntryEnabled(entry: ModEntry): boolean {
  return entry.kind === 'single' ? entry.mod.enabled : entry.enabledVariants.length > 0;
}

/** Sort key for ordering enabled/disabled sections. Uses the primary's
 *  priority for groups so reorder math stays consistent with the existing
 *  per-mod priority system. */
export function entrySortPriority(entry: ModEntry): number {
  return modLoadOrder(entry.kind === 'single' ? entry.mod : entry.primary);
}

/** Searchable display name for an entry (the visible card title). */
export function entryName(entry: ModEntry): string {
  return entry.kind === 'single' ? entry.mod.name : entry.primary.name;
}

/** Every string a search query may match this entry on. A group collapses many
 *  files under one card that shows only the primary's name, so searching a
 *  non-primary variant's name (e.g. "Bunny Ivy" when the card title is "Coat
 *  Ivy") must still surface the card. Match against every variant's name plus
 *  its user label / file header / original filename. */
export function entrySearchText(entry: ModEntry): string {
  if (entry.kind === 'single') return entry.mod.name;
  return entry.variants
    .flatMap((v) => [v.name, v.variantLabel, v.fileDescription, v.sourceFileName])
    .filter((s): s is string => !!s)
    .join('\n');
}

/** The mod we read metadata from for filtering (matches the visual primary). */
export function entryPrimaryMod(entry: ModEntry): Mod {
  return entry.kind === 'single' ? entry.mod : entry.primary;
}

/** Most recent install time across an entry's files (ISO string, so it sorts
 *  lexically = chronologically). Groups use their newest variant so a freshly
 *  downloaded file pulls the whole card to the top of "Recently added". */
export function entryInstalledAt(entry: ModEntry): string {
  if (entry.kind === 'single') return entry.mod.installedAt;
  return entry.variants.reduce(
    (latest, v) => (v.installedAt > latest ? v.installedAt : latest),
    entry.variants[0]?.installedAt ?? ''
  );
}

/** Whether membership/name are user-managed. Explicit local identity wins over
 * adopted GameBanana provenance, matching variantGroupKey and the main process. */
export function entryIsLocal(entry: ModEntry): boolean {
  return entry.kind === 'single'
    ? !!entry.mod.localGroupId ||
        !(typeof entry.mod.gameBananaId === 'number' && entry.mod.gameBananaId > 0)
    : entry.groupKey.startsWith('local:');
}

export const OTHER_TAG_KEY = 'other';

function heroNameFromTag(label?: string): string | null {
  if (!label) return null;
  const direct = heroNameForLabel(label);
  if (direct) return canonicalHeroName(direct);
  for (const part of label.split(/[/>]/).map((p) => p.trim()).filter(Boolean).reverse()) {
    const match = heroNameForLabel(part);
    if (match) return canonicalHeroName(match);
  }
  return null;
}

function modHeroName(mod: Mod): string | null {
  const tagged = canonicalHeroName(mod.lockerHero);
  if (tagged) return tagged;
  const categoryHero = heroNameFromTag(mod.categoryName);
  if (categoryHero) return categoryHero;
  const section = (mod.sourceSection ?? '').toLowerCase();
  if (section.includes('sound')) {
    const inferred = inferHeroFromTitle(mod.name);
    return inferred ? canonicalHeroName(inferred) : null;
  }
  return null;
}

export function entryHeroNames(entry: ModEntry): string[] {
  const mods = entry.kind === 'single' ? [entry.mod] : entry.variants;
  return Array.from(new Set(mods.map(modHeroName).filter((name): name is string => !!name)));
}

export function tagKeyLabel(key: string): string {
  if (key === OTHER_TAG_KEY) return 'Other';
  if (key === 'section:sound') return 'Sounds';
  if (key.startsWith('global:')) {
    const gt = key.slice('global:'.length) as GlobalModType;
    return GLOBAL_MOD_TYPE_LABELS[gt] ?? gt;
  }
  if (key.startsWith('cat:')) return key.slice('cat:'.length);
  if (key.startsWith('section:')) return key.slice('section:'.length);
  return key;
}

function modTagKeys(mod: Mod): string[] {
  const keys: string[] = [];
  const labels = new Set<string>();
  const add = (key: string) => {
    const labelKey = tagKeyLabel(key).trim().toLowerCase();
    if (!labelKey || labels.has(labelKey)) return;
    labels.add(labelKey);
    keys.push(key);
  };

  const global = getEffectiveGlobalType(mod);
  if (global) add(`global:${global}`);

  const section = (mod.sourceSection ?? '').trim();
  if (section.toLowerCase().includes('sound')) add('section:sound');

  const category = mod.categoryName?.trim();
  if (category && !heroNameFromTag(category)) add(`cat:${category}`);

  if (keys.length === 0 && section && section !== 'Mod') add(`section:${section}`);
  if (keys.length === 0) add(OTHER_TAG_KEY);
  return keys;
}

export function entryTagKeys(entry: ModEntry): string[] {
  const mods = entry.kind === 'single' ? [entry.mod] : entry.variants;
  return Array.from(new Set(mods.flatMap(modTagKeys)));
}

export function flattenEntries(entries: ModEntry[]): Mod[] {
  return entries.flatMap((entry) => (entry.kind === 'single' ? [entry.mod] : entry.variants));
}

export function entryRepresentativeId(entry: ModEntry): string {
  return entry.kind === 'single' ? entry.mod.id : entry.primary.id;
}

export function entryDisabledPreferenceKey(entry: ModEntry): string {
  return modPreferenceKey(entry.kind === 'single' ? entry.mod : entry.primary);
}

function entryFilesByEnabledState(entry: ModEntry, enabled: boolean): Mod[] {
  if (entry.kind === 'single') {
    return entry.mod.enabled === enabled ? [entry.mod] : [];
  }
  return entry.variants.filter((variant) => variant.enabled === enabled);
}

// Only enabled mods hold pakNN load-order slots; disabled mods live in
// .disabled/ with free-form names and aren't loaded by the game. Compacting
// covers the enabled mods alone (reorderMods ignores disabled ids anyway) and
// orders them by global load order so overflow-folder mods stay after base ones.
export function buildCompactPriorityOrder(entries: ModEntry[]): Mod[] {
  return entries
    .map((entry) => {
      const files = entryFilesByEnabledState(entry, true);
      const priority = files.length > 0
        ? Math.min(...files.map(modLoadOrder))
        : Number.POSITIVE_INFINITY;
      return { files, priority };
    })
    .filter(({ files }) => files.length > 0)
    .sort((a, b) => a.priority - b.priority)
    .flatMap(({ files }) => files);
}
