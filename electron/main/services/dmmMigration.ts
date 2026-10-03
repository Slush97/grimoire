/**
 * DMM -> Grimoire migration, expressed through the manager-neutral
 * interchange format: the DMM reader (modInterchange/dmmReader.ts) turns DMM's
 * on-disk data into an interchange document, and the interchange importer
 * (modInterchange/importer.ts) adopts it. This wrapper keeps the migration's
 * report shape for callers and tests that think in DMM terms.
 *
 * Non-destructive: DMM's files are never moved or deleted, so its install keeps
 * working after import. See importer.ts for the in-place vs copy rules and the
 * guards against stale DMM bookkeeping.
 */

import {
  interchangeKeyForEntry,
  type DmmAdoptionEntry,
  type DmmMigrationReport,
  type DmmMigrationRequest,
} from '../../../src/lib/dmmMigration';
import { readDmmLibrary } from './modInterchange/dmmReader';
import { importInterchange } from './modInterchange/importer';

export {
  dmmStatePathCandidates,
  defaultDmmStatePath,
} from './modInterchange/dmmReader';

export interface DmmMigrationOptions extends DmmMigrationRequest {
  /** Grimoire's Deadlock path (the migration target). Resolved from settings
   *  by the IPC layer. */
  deadlockPath: string;
  /** Dry run: build the plan + preview without copying anything. */
  planOnly?: boolean;
  /** Validates a submission id against Grimoire's local GameBanana catalog
   *  (mods-cache.db). Injected by the IPC layer so this service stays free of
   *  native sqlite imports (its tests run without Electron). Omitted = catalog
   *  unavailable, check skipped. Guards against stamping a bogus id (e.g. a
   *  digit-prefixed filename that isn't a GameBanana id) onto a real file. */
  isKnownSubmission?: (submissionId: number) => boolean;
}

/** Migrate (or, with planOnly, preview) a DMM install. Throws only when no DMM
 *  data is found at all. */
export async function migrateDmmInstall(opts: DmmMigrationOptions): Promise<DmmMigrationReport> {
  const read = await readDmmLibrary(opts);
  const outcome = await importInterchange(read.document, {
    deadlockPath: opts.deadlockPath,
    planOnly: opts.planOnly,
    isKnownSubmission: opts.isKnownSubmission,
    backupTag: 'pre-dmm-import',
  });

  const planned = new Map<string, DmmAdoptionEntry>(
    read.plan.entries.map((entry) => [interchangeKeyForEntry(entry), entry])
  );
  const submissionIdOf = (key: string) => planned.get(key)?.submissionId ?? 0;

  return {
    profileName: read.plan.profileName,
    enrichment: read.enrichment,
    mode: read.mode,
    preview: outcome.adoptable.map((mod) => ({
      key: mod.key,
      submissionId: submissionIdOf(mod.key),
      modName: planned.get(mod.key)?.modName,
      enabled: mod.enabled,
      priority: mod.order,
      hasFileId: planned.get(mod.key)?.fileId !== undefined,
    })),
    adopted: outcome.results
      .filter((result) => result.status === 'imported')
      .map((result) => {
        const entry = planned.get(result.key);
        return {
          key: result.key,
          submissionId: submissionIdOf(result.key),
          fileId: entry?.fileId,
          modName: entry?.modName,
          installedAs: result.installedAs ?? '',
          enabled: entry?.enabled ?? false,
          priority: entry?.priority ?? 0,
        };
      }),
    skipped: outcome.results
      .filter((result) => result.status !== 'imported')
      .map((result) => ({
        key: result.key,
        submissionId: submissionIdOf(result.key),
        reason: result.reason ?? 'not imported',
      })),
    warnings: [...read.document.warnings, ...outcome.warnings],
  };
}
