import type { Mod } from '../types/mod';
import type { CompatibilityReview } from './modCompatibility';
export { getInstallationScope as installedIssuesScope } from './appSettings';
import { buildModEntries, entryPrimaryMod } from './modEntries';
import { visibleInstalledMods } from './visibleMods';

interface IssueBase { key: string; modId: string }
export type InstalledIssue = IssueBase & (
  | { kind: 'camera' | 'data' | 'unknown' }
  | { kind: 'compatibility'; report: CompatibilityReview }
);
export interface InstalledIssueGroup {
  key: string;
  primary: Mod;
  mods: Mod[];
  issues: InstalledIssue[];
}

function normalizedRoot(path: string): string {
  const root = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:\/|^\/\//i.test(root) ? root.toLowerCase() : root;
}

/** Settings can change before their replacement inventory scan completes. */
export function installedIssueModsAtPath(mods: readonly Mod[], path: string | null): Mod[] {
  if (!path) return [];
  const root = normalizedRoot(path);
  const insensitive = /^[a-z]:\/|^\/\//i.test(root);
  const prefix = `${insensitive ? root.toLowerCase() : root}/`;
  return mods.filter(mod => {
    const candidate = mod.path.replaceAll('\\', '/');
    return (insensitive ? candidate.toLowerCase() : candidate).startsWith(prefix);
  });
}

/** Payload identity survives pak slot renames, enable toggles and reordering. */
export function installedIssueModIdentity(mod: Mod): string {
  if (mod.sha256) return `sha:${mod.sha256.toLowerCase()}`;
  if (mod.gameBananaId && mod.gameBananaFileId) return JSON.stringify([
    mod.sourceSection ?? 'Mod', mod.gameBananaId, mod.gameBananaFileId,
    mod.archiveVpkPath, mod.vpkIndex, mod.sourceFileName, mod.size,
  ]);
  return JSON.stringify([
    mod.sourceSection ?? 'Mod', mod.gameBananaId, mod.gameBananaFileId, mod.archiveVpkPath,
    mod.vpkIndex, mod.localGroupId, mod.sourceFileName, mod.name, mod.size, mod.installedAt,
  ]);
}

export function collectInstalledIssueGroups(
  mods: readonly Mod[],
  reports: readonly CompatibilityReview[] = [],
): InstalledIssueGroup[] {
  const groups: InstalledIssueGroup[] = [];
  const reportById = new Map(reports.map(report => [report.modId, report]));
  for (const entry of buildModEntries(visibleInstalledMods(mods))) {
    const members = entry.kind === 'single' ? [entry.mod] : entry.variants;
    const issues: InstalledIssue[] = [];
    for (const mod of members) {
      const payload = installedIssueModIdentity(mod);
      const add = (kind: 'camera' | 'data' | 'unknown', detail: unknown) =>
        issues.push({ key: JSON.stringify([payload, kind, detail]), modId: mod.id, kind });
      if (mod.staleModels?.length) add('camera', mod.staleModels.map(model => [model.entry, [...model.attachments].sort()]).sort());
      if (mod.enabled && mod.outdatedVdata?.length) add('data', mod.outdatedVdata.map(data => [data.entry, data.missing, [...data.sample].sort()]).sort());
      if (mod.isUnknown) add('unknown', null);
      const report = reportById.get(mod.id);
      if (report && (report.kind === 'failed' || report.findings.length > 0)) issues.push({
        key: JSON.stringify([payload, 'compatibility', report.kind === 'failed' ? report.error : report.findings]),
        modId: mod.id, kind: 'compatibility', report,
      });
    }
    if (issues.length) groups.push({ key: entry.key, primary: entryPrimaryMod(entry), mods: members, issues });
  }
  return groups;
}
