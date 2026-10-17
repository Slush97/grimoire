import type { AppSettings } from '../types/mod';
import type { PerformancePresetSummary, PerformancePresetVersion } from '../types/electron';

// The recommended default first, then mildest to strongest, with the author's
// work-in-progress config last.
const TIER_ORDER: PerformancePresetSummary['tier'][] = [
  'balanced',
  'light',
  'competitive',
  'aggressive',
  'maximum',
  'potato',
  'ultraPotato',
  'preview',
];

export function sortPresetsByTier(presets: PerformancePresetSummary[]): PerformancePresetSummary[] {
  return [...presets].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

/** The release to write for a preset: the saved pick, or the newest bundled
 *  one. A saved pick this build no longer bundles falls back to the newest:
 *  the history window slides on every upstream bump, so an old pick aging out
 *  is expected, not a fault. */
export function savedVersion(settings: AppSettings | null, preset: PerformancePresetSummary): string {
  const saved = settings?.performanceConfigVersions?.[preset.id];
  if (saved && preset.versions.some((v) => v.version === saved)) return saved;
  return preset.versions[0].version;
}

/** True when the user picked a bundled release by hand. That pick beats
 *  "Always use the newest version", the newest bundled release included:
 *  picking it while upstream has moved past it means "stay on this one". */
export function hasPinnedVersion(settings: AppSettings | null, preset: PerformancePresetSummary): boolean {
  const saved = settings?.performanceConfigVersions?.[preset.id];
  return !!saved && preset.versions.some((v) => v.version === saved);
}

/** The optional gameplay settings to write. Nothing saved means the creator's
 *  visibility/camera values; an explicit [] means the user turned them all
 *  off. Developer/testing tools are never implicit. */
export function savedOptIns(
  settings: AppSettings | null,
  preset: PerformancePresetSummary,
  version: string
): string[] {
  const release = preset.versions.find((v) => v.version === version) ?? preset.versions[0];
  const wanted =
    settings?.performanceConfigOptIns?.[preset.id] ??
    release.optIn.filter((c) => c.group !== 'devtools').map((c) => c.key);
  return wanted.filter((key) => release.optIn.some((c) => c.key === key));
}

/** The video.txt variant to write for a release that ships several: the saved
 *  pick when the release has it, otherwise its default (the first). Null when
 *  the release ships one or none, which is also when the card shows no choice. */
export function savedVideoVariant(
  settings: AppSettings | null,
  presetId: string,
  release: PerformancePresetVersion | null
): string | null {
  const variants = release?.videoVariants;
  if (!variants?.length) return null;
  const saved = settings?.performanceVideoVariants?.[presetId];
  return saved && variants.includes(saved) ? saved : variants[0];
}
