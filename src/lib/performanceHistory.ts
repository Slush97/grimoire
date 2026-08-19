import type { PerformanceRemoteVersion } from '../types/electron';

const PROSE_VERSION = /\b(?:v(?:ersion)?\s*)?(\d+\.\d+(?:\.\d+)?(?:[a-z]\d*)?)\b/i;

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
