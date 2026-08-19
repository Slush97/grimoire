import type { PerformancePresetVersion, PerformanceRemoteVersion } from '../types/electron';

const PROSE_VERSION = /\b(?:v(?:ersion)?\s*)?(\d+\.\d+(?:\.\d+)?(?:[a-z]\d*)?)\b/i;

/** Match a path-scoped history row to a bundled release. A prose release's
 * repository pin may be newer than the last commit that touched this specific
 * config, so `historyCommit` is the authoritative row identity. */
export function bundledPerformanceVersionFor(
  entry: PerformanceRemoteVersion,
  versions: readonly PerformancePresetVersion[]
): string | undefined {
  return versions.find(
    (version) =>
      version.version === entry.version ||
      (!!entry.commit &&
        (version.historyCommit === entry.commit || version.commit === entry.commit))
  )?.version;
}

/** Sqooky does not publish tags, but release commits conventionally start with
 *  a version ("2.9.1 release", "2.9 update"). Prefer that human version in
 *  the row while retaining the commit as the actual fetch identity. */
export function performanceHistoryRowCopy(
  entry: PerformanceRemoteVersion,
  bundledVersion?: string
): { primary: string; detail: string | null } {
  const label = entry.label?.trim() ?? '';
  const match = label.match(PROSE_VERSION);
  const version = bundledVersion ?? match?.[1] ?? null;
  const detail = match
    ? label.replace(match[0], '').replace(/^[\s:–—-]+/, '').trim()
    : label;
  return {
    primary: version ?? entry.ref,
    detail: detail || null,
  };
}
