import type { ModinfoRecord, ModinfoMergeSource } from '../../../src/types/modinfo';
import type { MergedModInfo, MergedModSource } from '../../../src/types/mod';

/**
 * Pure staleness predicate for the vpk-modinfo embed, split out of
 * imprintMods.ts so it can be unit-tested without dragging in the main-process
 * (fs / electron / vpkmerge) graph (profileResolver-style). The two inputs are
 * both plain data: the parsed embedded record (readEmbeddedModinfo's output)
 * and the refreshable fields the CURRENT metadata sidecar would produce.
 *
 * "Stale" means the next bulk imprint run should re-imprint the file:
 *  - it carries no current-format modinfo.json at all (never imprinted, a
 *    legacy-only embed, or an older schemaVersion: parseModinfo returns a
 *    record only for the current schema, so all three collapse to null), or
 *  - its refreshable fields no longer match the sidecar (the mod was
 *    identified / renamed / re-labeled AFTER it was imprinted).
 *
 * The KEYSTONE fields (identity triple, firstImprintedAt) and the per-write
 * bookkeeping (writtenAt, writtenBy) are deliberately NOT compared: they are
 * carried forward / refreshed by every re-imprint and must never make a file
 * look stale on their own.
 */

/** The subset of the metadata sidecar the staleness check reads. The full
 *  ModMetadata is assignable to this, so callers pass getModMetadata's result
 *  directly (tests pass a literal). */
export type ImprintRefreshMeta = {
    modName?: string;
    author?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    sourceSection?: string;
    categoryId?: number;
    categoryName?: string;
    vpkIndex?: number;
    variantLabel?: string;
};

/**
 * The embed fields a re-imprint refreshes from the sidecar. One flat shape for
 * both sides of the compare: derived from the sidecar via
 * refreshableFieldsFromMetadata and from an embedded record via
 * refreshableFieldsFromRecord.
 */
export interface RefreshableEmbedFields {
    title: string;
    author?: string;
    description?: string;
    gamebananaId?: number;
    gamebananaFileId?: number;
    sourceUrl?: string;
    section?: string;
    categoryId?: number;
    categoryName?: string;
    vpkIndex?: number;
    variantLabel?: string;
}

const REFRESHABLE_KEYS = [
    'title',
    'author',
    'description',
    'gamebananaId',
    'gamebananaFileId',
    'sourceUrl',
    'section',
    'categoryId',
    'categoryName',
    'vpkIndex',
    'variantLabel',
] as const satisfies ReadonlyArray<keyof RefreshableEmbedFields>;

export type RefreshableFieldKey = (typeof REFRESHABLE_KEYS)[number];

export type EmbedStaleness =
    | { stale: false }
    | { stale: true; reason: 'no-current-embed' }
    | { stale: true; reason: 'fields-drifted'; driftedFields: RefreshableFieldKey[] };

/** Which part of a merge record drifted. 'title' mirrors the single-mod
 *  RefreshableFieldKey; 'sources' covers the whole per-source list (a merge
 *  has no per-source-field granularity worth reporting, unlike the flat
 *  single-mod key set: a source added/removed/edited all read the same way,
 *  as "the source list changed"). */
export type MergeDriftField = 'title' | 'sources';

export type MergeEmbedStaleness =
    | { stale: false }
    | { stale: true; reason: 'no-current-embed' }
    | { stale: true; reason: 'fields-drifted'; driftedFields: MergeDriftField[] };

/** Build the GameBanana page URL for a mod, when its submission id is known. */
export function gameBananaPageUrl(
    gameBananaId: number | undefined,
    section: string | undefined
): string | undefined {
    if (!gameBananaId) return undefined;
    const path = section === 'Sound' ? 'sounds' : 'mods';
    return `https://gamebanana.com/${path}/${gameBananaId}`;
}

/**
 * Derive the refreshable fields the CURRENT sidecar would imprint. Must mirror
 * buildModinfoRecord (imprintMods.ts) exactly, field for field: every source
 * sub-field is gated on gameBananaId because the record only writes a `source`
 * block for GameBanana mods, so a local mod with a stray sourceSection in its
 * sidecar must not read as drifted forever. description is always absent
 * today: single-mod imprints do not write one.
 */
export function refreshableFieldsFromMetadata(
    meta: ImprintRefreshMeta | undefined,
    fallbackTitle: string
): RefreshableEmbedFields {
    const gbId = meta?.gameBananaId;
    return {
        title: meta?.modName || fallbackTitle,
        author: meta?.author,
        description: undefined,
        gamebananaId: gbId,
        gamebananaFileId: gbId ? meta?.gameBananaFileId : undefined,
        sourceUrl: gameBananaPageUrl(gbId, meta?.sourceSection),
        section: gbId ? meta?.sourceSection : undefined,
        categoryId: gbId ? meta?.categoryId : undefined,
        categoryName: gbId ? meta?.categoryName : undefined,
        vpkIndex: meta?.vpkIndex,
        variantLabel: meta?.variantLabel,
    };
}

/** Project an embedded record onto the same flat refreshable shape. */
export function refreshableFieldsFromRecord(record: ModinfoRecord): RefreshableEmbedFields {
    return {
        title: record.title,
        author: record.author,
        description: record.description,
        gamebananaId: record.source?.gamebananaId,
        gamebananaFileId: record.source?.gamebananaFileId,
        sourceUrl: record.source?.url,
        section: record.source?.section,
        categoryId: record.source?.categoryId,
        categoryName: record.source?.categoryName,
        vpkIndex: record.packaging?.vpkIndex,
        variantLabel: record.packaging?.variantLabel,
    };
}

/** Normalized compare axis: an empty / whitespace-only string counts as
 *  absent, so absent==absent regardless of which side omitted the field. */
function normalizeField(value: string | number | undefined): string | number | undefined {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}

/**
 * Decide whether a mod's embed needs a re-imprint. `embedded` is the parsed
 * current-format record, or null when the file carries none (never imprinted,
 * legacy-only embed, or an older schemaVersion; the parser yields null for all
 * of those, which is exactly the "migrate me" bucket).
 *
 * A `kind: "merge"` embed compared against a plain mod's refreshable fields
 * (no merge manifest in scope) always reads fresh: the merge path writes a
 * richer record a single-mod re-imprint would clobber with kind:"mod", and a
 * caller with no manifest has no basis to compare source lists anyway. Callers
 * that DO have the mod's `meta.merged` manifest should use
 * `evaluateMergeEmbedStaleness` instead, which actually compares the merge's
 * refreshable fields (title + per-source data) the same way this function
 * does for a single mod, so a merged mod whose sidecar drifted after the last
 * embed (re-labeled, a source's GameBanana metadata changed) is correctly
 * pending work rather than perpetually "fresh".
 */
export function evaluateEmbedStaleness(
    embedded: ModinfoRecord | null,
    current: RefreshableEmbedFields
): EmbedStaleness {
    if (embedded === null) return { stale: true, reason: 'no-current-embed' };
    if (embedded.kind === 'merge') return { stale: false };

    const embeddedFields = refreshableFieldsFromRecord(embedded);
    const driftedFields = REFRESHABLE_KEYS.filter(
        (key) => normalizeField(embeddedFields[key]) !== normalizeField(current[key])
    );
    if (driftedFields.length > 0) {
        return { stale: true, reason: 'fields-drifted', driftedFields };
    }
    return { stale: false };
}

// --- merge embed staleness ---------------------------------------------------

/** The refreshable fields of one merge source, projected onto a flat shape
 *  comparable across the manifest (MergedModSource) and the embedded record
 *  (ModinfoMergeSource). Keyed by fileNameAtMergeTime/fileName when aligning
 *  the two lists, since that is the field both sides key on elsewhere
 *  (makeSourceLocator in modMerger.ts). `vpkIndex` is deliberately excluded:
 *  it is captured into the embed at merge/rebuild time from each source's
 *  OWN metadata sidecar but never written back onto MergedModSource, so the
 *  manifest has no value to compare it against; treating it as refreshable
 *  would make every merge read stale forever. */
export interface RefreshableMergeSourceFields {
    fileNameAtMergeTime: string;
    title: string;
    gamebananaId?: number;
    gamebananaFileId?: number;
    section?: string;
    priorityAtMergeTime: number;
    enabledAtMergeTime: boolean;
}

/** The refreshable fields of a whole merge: the merge's own title plus every
 *  source's refreshable fields, in manifest order. */
export interface RefreshableMergeFields {
    title: string;
    sources: RefreshableMergeSourceFields[];
}

function refreshableMergeSourceFromManifest(source: MergedModSource): RefreshableMergeSourceFields {
    return {
        fileNameAtMergeTime: source.fileName,
        title: source.modName,
        gamebananaId: source.gameBananaId,
        gamebananaFileId: source.gameBananaId ? source.gameBananaFileId : undefined,
        section: source.gameBananaId ? source.section : undefined,
        priorityAtMergeTime: source.priorityAtMergeTime,
        enabledAtMergeTime: source.enabledAtMergeTime,
    };
}

function refreshableMergeSourceFromRecord(source: ModinfoMergeSource): RefreshableMergeSourceFields {
    return {
        fileNameAtMergeTime: source.fileNameAtMergeTime,
        title: source.title,
        gamebananaId: source.gamebananaId,
        gamebananaFileId: source.gamebananaId ? source.gamebananaFileId : undefined,
        section: source.gamebananaId ? source.section : undefined,
        priorityAtMergeTime: source.priorityAtMergeTime,
        enabledAtMergeTime: source.enabledAtMergeTime,
    };
}

/** Derive the refreshable fields a fresh re-embed would write for a merge,
 *  straight from the CURRENT metadata sidecar's manifest (mirrors
 *  refreshableFieldsFromMetadata for the single-mod case). `modName` falls
 *  back to the manifest id the same way a single mod falls back to its scan
 *  name, so an unlabeled merge does not read as perpetually drifted. */
export function refreshableMergeFieldsFromMetadata(
    modName: string | undefined,
    merged: MergedModInfo
): RefreshableMergeFields {
    return {
        title: modName || merged.id,
        sources: merged.sources.map(refreshableMergeSourceFromManifest),
    };
}

/** Project an embedded kind:"merge" record onto the same flat refreshable
 *  shape (mirrors refreshableFieldsFromRecord for the single-mod case). */
export function refreshableMergeFieldsFromRecord(
    record: { title: string; sources: ModinfoMergeSource[] }
): RefreshableMergeFields {
    return {
        title: record.title,
        sources: record.sources.map(refreshableMergeSourceFromRecord),
    };
}

/**
 * Decide whether a MERGED mod's embed needs a re-imprint: the merge-record
 * counterpart of evaluateEmbedStaleness. `embedded` is the parsed
 * current-format kind:"merge" record (a kind:"mod" record here means the
 * file was flattened by something else and is handled by the caller's
 * never-flatten guard, not this predicate; pass null to route it through the
 * same "no-current-embed" bucket as never-imprinted). Compares the merge's
 * own title plus every source's refreshable fields, aligned on
 * fileNameAtMergeTime (the same key makeSourceLocator uses), so a merge
 * re-labeled or whose source metadata changed after the last embed reads
 * stale instead of forever "fresh". A source-count mismatch (a source was
 * extracted / the manifest gained one) is itself a drift signal.
 */
export function evaluateMergeEmbedStaleness(
    embedded: RefreshableMergeFields | null,
    current: RefreshableMergeFields
): MergeEmbedStaleness {
    if (embedded === null) return { stale: true, reason: 'no-current-embed' };

    const driftedFields: MergeDriftField[] = [];
    if (normalizeField(embedded.title) !== normalizeField(current.title)) {
        driftedFields.push('title');
    }

    const bySourceFile = new Map(embedded.sources.map((s) => [s.fileNameAtMergeTime, s]));
    let sourcesDrifted = current.sources.length !== embedded.sources.length;
    for (const source of current.sources) {
        const match = bySourceFile.get(source.fileNameAtMergeTime);
        if (!match || !sourceFieldsEqual(match, source)) {
            sourcesDrifted = true;
            break;
        }
    }
    if (sourcesDrifted) driftedFields.push('sources');

    return driftedFields.length > 0
        ? { stale: true, reason: 'fields-drifted', driftedFields }
        : { stale: false };
}

function sourceFieldsEqual(
    a: RefreshableMergeSourceFields,
    b: RefreshableMergeSourceFields
): boolean {
    return (
        normalizeField(a.title) === normalizeField(b.title) &&
        normalizeField(a.gamebananaId) === normalizeField(b.gamebananaId) &&
        normalizeField(a.gamebananaFileId) === normalizeField(b.gamebananaFileId) &&
        normalizeField(a.section) === normalizeField(b.section) &&
        a.priorityAtMergeTime === b.priorityAtMergeTime &&
        a.enabledAtMergeTime === b.enabledAtMergeTime
    );
}

// --- never-flatten guard ------------------------------------------------------

/**
 * Decide how to handle a mod whose metadata sidecar has NO `merged` entry, the
 * pure seam behind the never-flatten guard in imprintMods.ts. Never-flatten's
 * rule: `meta.merged` being absent does NOT by itself mean "this is a plain
 * mod". If the file's own embedded data says otherwise, that data wins, because
 * flattening it to kind:"mod" would permanently destroy the only remaining
 * record of the merge's source list. Three inputs, evaluated in this order:
 *
 *  1. `embeddedKind === 'merge'`: the CURRENT-format modinfo.json is itself a
 *     merge record. Sidecar loss (DB wipe, orphan-metadata prune) does not
 *     change what the file IS; reconstruct from the embed (richest source,
 *     since it is the last thing Grimoire itself wrote).
 *  2. `embeddedKind === null` (no current embed) but a legacy grimoire_meta.json
 *     with a readable source list is present: reconstruct from the legacy
 *     document (older file, DB wiped before ever migrating to the new format).
 *  3. Neither: this looks like a genuine plain mod (or a legacy merge whose
 *     companion is missing/unreadable/structurally broken). Caller proceeds
 *     with normal single-mod handling... UNLESS `embeddedKind === 'mod'`,
 *     which means a current-format record exists and positively says "this is
 *     a single mod", the one case that is unambiguously safe to treat as such.
 *
 * Returns `'no-manifest-needed'` for genuinely plain mods (including a
 * legacy-merge-shaped file with an unreadable companion, since there is
 * nothing to reconstruct FROM: the caller's normal anomaly guard still runs
 * and may flag it separately on other grounds).
 */
export type NeverFlattenOutcome =
    | { kind: 'no-manifest-needed' }
    | { kind: 'reconstruct-from-embed' }
    | { kind: 'reconstruct-from-legacy' };

export function classifyMissingMergeManifest(
    embeddedKind: 'mod' | 'merge' | null,
    legacyHasReadableSources: boolean
): NeverFlattenOutcome {
    if (embeddedKind === 'merge') return { kind: 'reconstruct-from-embed' };
    if (embeddedKind === null && legacyHasReadableSources) return { kind: 'reconstruct-from-legacy' };
    return { kind: 'no-manifest-needed' };
}
