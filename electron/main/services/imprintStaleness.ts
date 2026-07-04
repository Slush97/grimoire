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
 * The IDENTITY-bearing subset of RefreshableFieldKey: the fields adoption
 * fills in from a richer embed (see deriveAdoptionPatch below), PLUS
 * `sourceUrl`, which is not itself adopted (it isn't a real sidecar field,
 * gameBananaPageUrl derives it from gamebananaId + section) but is purely a
 * function of fields that ARE identity-bearing, so its drift is fully
 * explained by theirs and must track the same direction exemption or a
 * richer-embed mod would read stale on sourceUrl alone even though the field
 * it's derived from is correctly adoption material. Directional hardening
 * (evaluateEmbedStaleness) treats embed-has/sidecar-lacks on these specific
 * keys as adoption material, not drift, so an imported orphan whose sidecar
 * is impoverished relative to its own embed never reads as stale purely
 * because the sidecar hasn't caught up yet. `title` is deliberately excluded:
 * a fallback scan-name sidecar vs. a titled embed IS legitimate "sidecar needs
 * the title" drift the normal refresh already handles well (and adoption
 * itself only fills title when the sidecar has none, so the two rules agree
 * once adoption runs).
 */
const IDENTITY_BEARING_KEYS = [
    'gamebananaId',
    'gamebananaFileId',
    'author',
    'sourceUrl',
    'section',
    'categoryId',
    'categoryName',
] as const satisfies ReadonlyArray<RefreshableFieldKey>;

/** True when `key` drifted only in the "embed has it, sidecar doesn't"
 *  direction on an identity-bearing field. Sidecar-has/embed-lacks and
 *  both-present-but-different remain real drift (a legitimate refresh),
 *  exactly like every other field; only the adoption direction is exempted. */
function isAdoptionDirectionDrift(
    key: RefreshableFieldKey,
    embeddedValue: string | number | undefined,
    currentValue: string | number | undefined
): boolean {
    if (!(IDENTITY_BEARING_KEYS as readonly string[]).includes(key)) return false;
    const embeddedNorm = normalizeField(embeddedValue);
    const currentNorm = normalizeField(currentValue);
    return embeddedNorm !== undefined && currentNorm === undefined;
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
 *
 * DIRECTIONAL HARDENING: a richer embed than the sidecar on an identity-bearing
 * field (see IDENTITY_BEARING_KEYS) is adoption material, not drift, so it is
 * excluded from driftedFields here. This is defense in depth alongside
 * deriveAdoptionPatch: once adoption runs, the sidecar absorbs the embed's
 * richer fields and this rule stops mattering for that mod, but a hand-edited
 * sidecar or a future caller that skips adoption must never see "sidecar is
 * missing what the embed already knows" reported as pending work, because the
 * only fix bulk/preflight apply for staleness is a re-imprint FROM the sidecar,
 * which would destroy the very data this rule is protecting.
 */
export function evaluateEmbedStaleness(
    embedded: ModinfoRecord | null,
    current: RefreshableEmbedFields
): EmbedStaleness {
    if (embedded === null) return { stale: true, reason: 'no-current-embed' };
    if (embedded.kind === 'merge') return { stale: false };

    const embeddedFields = refreshableFieldsFromRecord(embedded);
    const driftedFields = REFRESHABLE_KEYS.filter((key) => {
        const embeddedValue = embeddedFields[key];
        const currentValue = current[key];
        if (normalizeField(embeddedValue) === normalizeField(currentValue)) return false;
        return !isAdoptionDirectionDrift(key, embeddedValue, currentValue);
    });
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

// --- adoption ------------------------------------------------------------------

/**
 * The subset of ModMetadata an adoption patch can fill in. A strict subset of
 * ImprintRefreshMeta (every adoptable field is also a refreshable one), kept as
 * its own type so a caller reading the return value never has to wonder
 * whether `sha256` or any other sidecar field could show up here (it can't:
 * NEVER include identity in an adoption patch, see the module-level KEYSTONE
 * note on deriveAdoptionPatch).
 */
export interface AdoptionPatch {
    modName?: string;
    author?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    sourceSection?: string;
    categoryId?: number;
    categoryName?: string;
    vpkIndex?: number;
    variantLabel?: string;
}

/** Every AdoptionPatch field except `modName` (which follows a slightly
 *  different fill-missing rule: it reads the embed's `title`, not a same-named
 *  field, and is handled separately in deriveAdoptionPatch). Type-only: there
 *  is no runtime array to iterate since deriveAdoptionPatch writes each field
 *  out explicitly (so every write stays checked against AdoptionPatch's real
 *  field types, with no cast); this alias just keeps currentAdoptableValue /
 *  embedAdoptableValue's parameter type in one named place. */
type AdoptableKey = Exclude<keyof AdoptionPatch, 'modName'>;

/**
 * A richer embed's fields, projected onto the same flat shape adoption reads
 * from, sourced from EITHER a current-format kind:"mod" record (via
 * refreshableFieldsFromRecord) or a legacy addoninfo.txt embed (whose fields
 * are much sparser: title/author/gamebananaId/gamebananaFileId only, no
 * section/category/vpkIndex, since the legacy format never carried those).
 * Callers build this from whichever embed reader actually found something;
 * `deriveAdoptionPatch` doesn't care which source it came from.
 */
export interface AdoptionEmbedFields {
    title?: string;
    author?: string;
    gamebananaId?: number;
    gamebananaFileId?: number;
    section?: string;
    categoryId?: number;
    categoryName?: string;
    vpkIndex?: number;
    variantLabel?: string;
}

/** Project a current-format kind:"mod" record onto AdoptionEmbedFields (a
 *  restriction of refreshableFieldsFromRecord to the fields adoption cares
 *  about; description/sourceUrl are derived, never adopted directly). */
export function adoptionFieldsFromModRecord(record: RefreshableEmbedFields): AdoptionEmbedFields {
    return {
        title: record.title,
        author: record.author,
        gamebananaId: record.gamebananaId,
        gamebananaFileId: record.gamebananaFileId,
        section: record.section,
        categoryId: record.categoryId,
        categoryName: record.categoryName,
        vpkIndex: record.vpkIndex,
        variantLabel: record.variantLabel,
    };
}

/** Project a legacy addoninfo.txt embed onto AdoptionEmbedFields. Legacy
 *  gamebananaId/gamebananaFileId are stored as strings (addoninfo.txt is a
 *  flat KV1 text format); numeric coercion mirrors buildAddonFields's own
 *  `String(...)` round trip on the way in. An unparseable numeric string
 *  yields undefined rather than NaN, so a corrupt legacy value is simply not
 *  adopted instead of poisoning the patch. */
export function adoptionFieldsFromLegacyAddonInfo(embed: {
    title?: string;
    author?: string;
    gamebananaId?: string;
    gamebananaFileId?: string;
}): AdoptionEmbedFields {
    const toNumber = (value: string | undefined): number | undefined => {
        if (value === undefined) return undefined;
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    };
    return {
        title: embed.title,
        author: embed.author,
        gamebananaId: toNumber(embed.gamebananaId),
        gamebananaFileId: toNumber(embed.gamebananaFileId),
    };
}

/** Read one adoptable field off the current sidecar, keyed by AdoptableKey: a
 *  small indirection so deriveAdoptionPatch's per-field checks share one
 *  lookup instead of repeating the field-name mapping. */
function currentAdoptableValue(
    meta: ImprintRefreshMeta | undefined,
    key: AdoptableKey
): string | number | undefined {
    switch (key) {
        case 'gameBananaId': return meta?.gameBananaId;
        case 'gameBananaFileId': return meta?.gameBananaFileId;
        case 'author': return meta?.author;
        case 'sourceSection': return meta?.sourceSection;
        case 'categoryId': return meta?.categoryId;
        case 'categoryName': return meta?.categoryName;
        case 'vpkIndex': return meta?.vpkIndex;
        case 'variantLabel': return meta?.variantLabel;
    }
}

/** The embed field that feeds each adoptable sidecar key. Separate from
 *  currentAdoptableValue because the two shapes use different names for the
 *  same concept (sourceSection <-> section, gameBananaId <-> gamebananaId). */
function embedAdoptableValue(
    embed: AdoptionEmbedFields,
    key: AdoptableKey
): string | number | undefined {
    switch (key) {
        case 'gameBananaId': return embed.gamebananaId;
        case 'gameBananaFileId': return embed.gamebananaFileId;
        case 'author': return embed.author;
        case 'sourceSection': return embed.section;
        case 'categoryId': return embed.categoryId;
        case 'categoryName': return embed.categoryName;
        case 'vpkIndex': return embed.vpkIndex;
        case 'variantLabel': return embed.variantLabel;
    }
}

/**
 * Derive the adoption patch: the fields an imported-but-already-imprinted
 * mod's richer embed should backfill into an impoverished sidecar. Fixes the
 * live bug where import-custom-mod stamps only {modName, thumbnailUrl, nsfw},
 * so importing an already-imprinted VPK creates a sidecar that knows nothing
 * about the embed's gamebananaId/author/category/etc.; the next bulk imprint
 * then classifies the mod stale (per the OLD staleness rule) and re-imprints
 * FROM that impoverished sidecar, destroying the embed's real identity.
 *
 * Rule: for every adoptable key, patch it in ONLY when the sidecar has NO
 * value and the embed has one. NEVER overwrite a present sidecar value: the
 * sidecar is the user-editable side (rename, re-tag, re-associate), so where
 * both exist the sidecar wins and the normal refreshableFieldsFromMetadata /
 * evaluateEmbedStaleness refresh path applies exactly as it always has.
 * `modName` follows the same fill-missing rule but reads the embed's `title`;
 * a user-typed import name always wins (the caller merges this patch UNDER
 * the user's typed name, but the rule holds even if a caller merged the other
 * way: an empty sidecar modName is the only case this fills).
 *
 * KEYSTONE: the return type (AdoptionPatch) structurally cannot carry sha256
 * or any identity field, and this function never reads or forwards identity
 * data from either input. Canonical identity is established exclusively by
 * imprintModCore's carryForwardOriginalIdentity path, never by adoption.
 *
 * `embed` is null when the mod carries no recoverable Grimoire embed at all
 * (a genuinely fresh local import): returns an empty patch, since there is
 * nothing to adopt from. A `kind: "merge"` embed is the caller's
 * responsibility to route elsewhere BEFORE calling this (see the module doc):
 * merges reconstruct their manifest via classifyOrphanMerge /
 * recoverMergedModInfo, which already handles the full source list a flat
 * field patch here could never represent, so this function only ever sees
 * single-mod-shaped embed fields for a merge candidate's plain-field pass
 * (harmless: a merge's `meta.merged` presence routes the mod away from this
 * function entirely in every wired call site).
 */
export function deriveAdoptionPatch(
    embed: AdoptionEmbedFields | null,
    meta: ImprintRefreshMeta | undefined
): AdoptionPatch {
    if (embed === null) return {};

    // Fill-missing per adoptable key: only when the sidecar has none and the
    // embed has one. Written out field-by-field (rather than looping with a
    // generic assignment) so every write stays type-checked against
    // AdoptionPatch's actual field types, with no cast.
    const adopt = (key: AdoptableKey): boolean =>
        normalizeField(currentAdoptableValue(meta, key)) === undefined &&
        normalizeField(embedAdoptableValue(embed, key)) !== undefined;

    const patch: AdoptionPatch = {};
    if (adopt('gameBananaId')) {
        const value = embedAdoptableValue(embed, 'gameBananaId');
        if (typeof value === 'number') patch.gameBananaId = value;
    }
    if (adopt('gameBananaFileId')) {
        const value = embedAdoptableValue(embed, 'gameBananaFileId');
        if (typeof value === 'number') patch.gameBananaFileId = value;
    }
    if (adopt('author')) {
        const value = embedAdoptableValue(embed, 'author');
        if (typeof value === 'string') patch.author = value;
    }
    if (adopt('sourceSection')) {
        const value = embedAdoptableValue(embed, 'sourceSection');
        if (typeof value === 'string') patch.sourceSection = value;
    }
    if (adopt('categoryId')) {
        const value = embedAdoptableValue(embed, 'categoryId');
        if (typeof value === 'number') patch.categoryId = value;
    }
    if (adopt('categoryName')) {
        const value = embedAdoptableValue(embed, 'categoryName');
        if (typeof value === 'string') patch.categoryName = value;
    }
    if (adopt('vpkIndex')) {
        const value = embedAdoptableValue(embed, 'vpkIndex');
        if (typeof value === 'number') patch.vpkIndex = value;
    }
    if (adopt('variantLabel')) {
        const value = embedAdoptableValue(embed, 'variantLabel');
        if (typeof value === 'string') patch.variantLabel = value;
    }

    if (normalizeField(meta?.modName) === undefined) {
        const title = embed.title;
        if (typeof title === 'string' && normalizeField(title) !== undefined) patch.modName = title;
    }

    return patch;
}
