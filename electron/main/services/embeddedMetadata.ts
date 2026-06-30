import { fingerprintFile } from './fileMatch';
import { crc32File } from './archiveCrc';
import { readVpkEntryBytes } from './vpk';
import type { ParsedAddonInfo } from './vpkIdentity';

/**
 * Serialization + identity helpers for the self-identifying VPK embed
 * (see docs/vpk-metadata-embed-integration.md). Grimoire owns ALL of this:
 * it serializes `addoninfo.txt` and `grimoire_meta.json` itself, computes the
 * original whole-file identity, and reads existing embeds back for idempotency.
 * vpkmerge is a dumb byte-embedder: it gets these blobs via `--extra-file` and
 * never interprets them.
 */

/** Root-level VPK entry that carries the embedded AddonInfo block. */
export const ADDONINFO_ENTRY = 'addoninfo.txt';

/** Root-level VPK entry that carries a merge's `grimoire_meta.json` companion. */
export const GRIMOIRE_META_ENTRY = 'grimoire_meta.json';

/** `format` discriminator stamped into every `grimoire_meta.json`. */
export const GRIMOIRE_MERGE_FORMAT = 'grimoire-embedded-merge';

/** Current `grimoire_meta.json` schema version. Bump on any shape change. */
export const GRIMOIRE_MERGE_SCHEMA_VERSION = 1;

/** Default `addonversion` when a caller does not supply one. */
const DEFAULT_ADDON_VERSION = '1.0';

const SHA256_RE = /^[0-9a-f]{64}$/i;

// --- addoninfo.txt -----------------------------------------------------------

/**
 * Fields for the embedded `addoninfo.txt` AddonInfo block. The `grimoireOriginal*`
 * triple is the canonical-identity anchor `resolveVpkIdentity` reads back; the
 * GameBanana / descriptive fields let an orphaned-but-tagged file be identified
 * offline. Absent optionals are omitted from the output entirely.
 */
export interface AddonInfoFields {
    /** `addontitle`: the mod name, or a merge name. */
    title: string;
    /** `addonauthor`: the author, or "Multiple (merged via Grimoire)". */
    author: string;
    /** `addonversion`. Defaults to "1.0" when omitted. */
    version?: string;
    /** `addonDescription`. */
    description?: string;
    /** `gamebananaId` (numeric submission id as a string). Omit if local. */
    gamebananaId?: string;
    /** `sourceUrl` (GameBanana page url). Omit if local. */
    sourceUrl?: string;
    /** `buildDate` (ISO 8601, caller clock). */
    buildDate?: string;
    /** `grimoireOriginalSha256`: 64-hex original whole-file sha256. */
    grimoireOriginalSha256: string;
    /** `grimoireOriginalCrc32`: 8-hex original whole-file CRC-32. */
    grimoireOriginalCrc32?: string;
    /** `grimoireOriginalSize`: original whole-file byte length. */
    grimoireOriginalSize?: number;
    /** `grimoireMeta`: pointer flag set only on merges (the companion entry name). */
    grimoireMeta?: string;
}

/**
 * Serialize an `addoninfo.txt` KeyValues1 AddonInfo block. Matches the classic
 * Source-engine layout (4-space indent, unquoted keys, quoted values) so any VPK
 * browser shows it. Values are quoted; embedded backslashes and double quotes are
 * escaped (`\` -> `\\`, `"` -> `\"`, backslash first). Absent optionals are
 * omitted. The key order follows docs/vpk-metadata-embed-integration.md.
 */
export function serializeAddonInfo(fields: AddonInfoFields): string {
    const lines: string[] = ['"AddonInfo"', '{'];

    const write = (key: string, value: string | undefined): void => {
        if (value === undefined || value === '') return;
        lines.push(`    ${key} "${escapeKvValue(value)}"`);
    };

    write('addonversion', fields.version ?? DEFAULT_ADDON_VERSION);
    write('addontitle', fields.title);
    write('addonauthor', fields.author);
    write('addonDescription', fields.description);
    write('gamebananaId', fields.gamebananaId);
    write('sourceUrl', fields.sourceUrl);
    write('buildDate', fields.buildDate);
    write('grimoireOriginalSha256', fields.grimoireOriginalSha256);
    write('grimoireOriginalCrc32', fields.grimoireOriginalCrc32);
    write(
        'grimoireOriginalSize',
        fields.grimoireOriginalSize === undefined ? undefined : String(fields.grimoireOriginalSize)
    );
    write('grimoireMeta', fields.grimoireMeta);

    lines.push('}', '');
    return lines.join('\n');
}

function escapeKvValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- grimoire_meta.json ------------------------------------------------------

/** One source inside a merge, as projected into `grimoire_meta.json`. */
export interface GrimoireMergeSourceInput {
    modName: string;
    /** Source original whole-file sha256 (sha256AtMergeTime from Phase 1). */
    originalSha256?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    section?: string;
    priorityAtMergeTime: number;
    enabledAtMergeTime: boolean;
    fileNameAtMergeTime: string;
}

/** Everything needed to serialize a merge's `grimoire_meta.json`. */
export interface GrimoireMergeMetaInput {
    /** Merge name. */
    title: string;
    /** The merged VPK's own original whole-file sha256 (its self-identity). */
    originalSha256: string;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** Grimoire app version. */
    appVersion: string;
    game: { name: string; steamAppId: number; gameBananaGameId: number };
    sources: GrimoireMergeSourceInput[];
}

/** Parsed `grimoire_meta.json` source, as read back from an embed. */
export interface GrimoireEmbeddedMergeSource {
    modName?: string;
    originalSha256?: string | null;
    gameBananaId?: number | null;
    gameBananaFileId?: number | null;
    section?: string | null;
    priorityAtMergeTime?: number;
    enabledAtMergeTime?: boolean;
    fileNameAtMergeTime?: string;
}

/** Parsed `grimoire_meta.json` document, as read back from an embed. */
export interface GrimoireEmbeddedMerge {
    format: string;
    schemaVersion: number;
    game?: { name?: string; steamAppId?: number; gameBananaGameId?: number };
    createdBy?: { tool?: string; version?: string };
    createdAt?: string;
    merge?: { title?: string; originalSha256?: string };
    sources: GrimoireEmbeddedMergeSource[];
}

/**
 * Serialize a merge's `grimoire_meta.json` (the versioned, documented projection
 * of `MergedModInfo`, including LOCAL sources and each source's original hash).
 * A DB-wiped Grimoire reads this back to repopulate the merged-mod metadata and
 * drive unmerge / extractMergeSource. Absent per-source GameBanana ids / section
 * / hash serialize as JSON `null` to keep the shape stable behind schemaVersion.
 */
export function serializeGrimoireMeta(input: GrimoireMergeMetaInput): string {
    const doc = {
        format: GRIMOIRE_MERGE_FORMAT,
        schemaVersion: GRIMOIRE_MERGE_SCHEMA_VERSION,
        game: {
            name: input.game.name,
            steamAppId: input.game.steamAppId,
            gameBananaGameId: input.game.gameBananaGameId,
        },
        createdBy: { tool: 'grimoire', version: input.appVersion },
        createdAt: input.createdAt,
        merge: {
            title: input.title,
            originalSha256: input.originalSha256,
        },
        sources: input.sources.map((s) => ({
            modName: s.modName,
            originalSha256: s.originalSha256 ?? null,
            gameBananaId: s.gameBananaId ?? null,
            gameBananaFileId: s.gameBananaFileId ?? null,
            section: s.section ?? null,
            priorityAtMergeTime: s.priorityAtMergeTime,
            enabledAtMergeTime: s.enabledAtMergeTime,
            fileNameAtMergeTime: s.fileNameAtMergeTime,
        })),
    };
    return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Read and parse the embedded `grimoire_meta.json` from a VPK, or null when the
 * file carries none, it cannot be read, or it is not a Grimoire merge document.
 */
export function readEmbeddedGrimoireMeta(path: string): GrimoireEmbeddedMerge | null {
    try {
        const bytes = readVpkEntryBytes(path, GRIMOIRE_META_ENTRY);
        if (!bytes) return null;
        const parsed = JSON.parse(bytes.toString('utf-8')) as Partial<GrimoireEmbeddedMerge>;
        if (!parsed || parsed.format !== GRIMOIRE_MERGE_FORMAT) return null;
        return {
            format: parsed.format,
            schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0,
            game: parsed.game,
            createdBy: parsed.createdBy,
            createdAt: parsed.createdAt,
            merge: parsed.merge,
            sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        };
    } catch (error) {
        console.warn(`[embeddedMetadata] Failed to read embedded grimoire_meta.json from ${path}:`, error);
        return null;
    }
}

// --- original identity -------------------------------------------------------

/** Original (pre-first-tag) whole-file identity of a VPK. */
export interface OriginalIdentity {
    /** 64-hex original whole-file sha256, lowercased. */
    sha256: string;
    /** 8-hex original whole-file CRC-32, lowercased. */
    crc32?: string;
    /** Original whole-file byte length. */
    size?: number;
}

/**
 * Compute a VPK's original whole-file identity directly from its bytes. Use this
 * only on bytes that are still ORIGINAL (untagged), e.g. the freshly-merged-but-
 * not-yet-embedded merge output, or a single mod being tagged for the first time.
 * For a file that may already carry an embed, prefer carryForwardOriginalIdentity
 * so an existing original hash is never recomputed from already-tagged bytes.
 */
export async function computeOriginalIdentity(path: string): Promise<OriginalIdentity> {
    const [fingerprint, crc32] = await Promise.all([fingerprintFile(path), crc32File(path)]);
    return {
        sha256: fingerprint.sha256.toLowerCase(),
        crc32: crc32.toLowerCase(),
        size: fingerprint.size,
    };
}

/**
 * Carry an existing embed's `grimoireOriginal*` triple forward as the original
 * identity, so re-tagging an already-tagged file never recomputes "original"
 * from its (now mutated) bytes. Returns null when the embed carries no valid
 * original sha256, in which case the caller should computeOriginalIdentity from
 * the bytes instead (they are still original).
 */
export function carryForwardOriginalIdentity(embed: ParsedAddonInfo | undefined): OriginalIdentity | null {
    const sha = embed?.grimoireOriginalSha256;
    if (!sha || !SHA256_RE.test(sha)) return null;
    return {
        sha256: sha.toLowerCase(),
        crc32: embed?.grimoireOriginalCrc32?.toLowerCase(),
        size: embed?.grimoireOriginalSize,
    };
}
