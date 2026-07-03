import type { ModinfoRecord } from '../../../src/types/modinfo';

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
 * kind:"merge" records always read fresh here: the merge path writes a richer
 * record (source list) that a single-mod re-imprint would clobber with
 * kind:"mod". Merged mods are excluded from bulk imprinting anyway, but a
 * merge whose sidecar was lost must not be flattened by this predicate.
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
