import type { AppSettings } from '../types/mod';
import type { PerformancePresetSummary } from '../types/electron';

// Mildest to strongest, with the author's work-in-progress config last.
const TIER_ORDER: PerformancePresetSummary['tier'][] = [
  'balanced',
  'competitive',
  'aggressive',
  'maximum',
  'potato',
  'preview',
];

export function sortPresetsByTier(presets: PerformancePresetSummary[]): PerformancePresetSummary[] {
  return [...presets].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

/** The release to write for a preset: the saved pick, a remote-pinned
 *  historical version, or the newest bundled one. A saved pick this build no
 *  longer bundles falls back to the newest: the history window slides on every
 *  upstream bump, so an old pin aging out is expected, not a fault. */
export function savedVersion(settings: AppSettings | null, preset: PerformancePresetSummary): string {
  const saved = settings?.performanceConfigVersions?.[preset.id];
  if (saved && preset.versions.some((v) => v.version === saved)) return saved;
  if (saved && settings?.performanceConfigRemotePins?.[preset.id]?.version === saved) return saved;
  return preset.versions[0].version;
}

/** The optional gameplay settings to write. Nothing saved means the creator's
 *  visibility/camera values; an explicit [] means the user turned them all
 *  off. Developer/testing tools are never implicit. A remote-pinned version
 *  borrows the newest bundled release's list (near-identical across releases,
 *  and the apply filters keys against what it actually writes). */
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
