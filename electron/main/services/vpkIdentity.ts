import { fingerprintFile } from './fileMatch';
import { parseVpkDirectoryCached, readVpkEntryBytes } from './vpk';

/**
 * Canonical-identity resolver for VPK mods (see docs/vpk-metadata-embed-integration.md).
 *
 * The canonical identity of a VPK is its ORIGINAL (pre-first-tag) whole-file
 * sha256. When Grimoire tags a VPK in place it embeds a root-level
 * `addoninfo.txt` carrying that original hash, because the tag mutates the file
 * and changes its live hash. This resolver is the single read path: if the file
 * carries a well-formed embedded original hash, it returns that; otherwise it
 * falls back to hashing the live bytes.
 *
 * For an untagged file (no `addoninfo.txt`) this is a no-op: the live hash IS
 * the original hash, so every site that routes through here behaves exactly as
 * it did before embeds existed.
 */

/** A 64-hex sha256, case-insensitive. */
const SHA256_RE = /^[0-9a-f]{64}$/i;

/** Root-level VPK entry that carries the embedded AddonInfo block. */
const ADDONINFO_ENTRY = 'addoninfo.txt';

/**
 * Parsed projection of the embedded `addoninfo.txt` AddonInfo block. The
 * `grimoireOriginal*` triple is the canonical-identity anchor; the GameBanana /
 * descriptive fields are read here so the phase-2 unknown-mod reader can
 * identify an orphaned-but-tagged file offline. `raw` keeps every flat key for
 * forward-compatible reads of fields added later.
 */
export interface ParsedAddonInfo {
    grimoireOriginalSha256?: string;
    grimoireOriginalCrc32?: string;
    grimoireOriginalSize?: number;
    gamebananaId?: string;
    sourceUrl?: string;
    title?: string;
    author?: string;
    /** Pointer flag set only on merges (companion `grimoire_meta.json` present). */
    grimoireMeta?: string;
    /** Every flat string key/value parsed from the AddonInfo block (lowercased keys). */
    raw: Record<string, string>;
}

export interface VpkIdentity {
    /** Canonical (original) whole-file sha256, lowercased. */
    sha256: string;
    /** Original whole-file CRC-32, only when read from an embed. */
    crc32?: string;
    /** Original whole-file byte length. */
    size?: number;
    /** Where the identity came from. */
    source: 'embed' | 'live';
    /** The parsed AddonInfo block, when one was present and well-formed. */
    embedded?: ParsedAddonInfo;
}

/**
 * Resolve a VPK's canonical identity. Returns the embedded original hash when
 * the file carries a well-formed `addoninfo.txt`, otherwise the live whole-file
 * hash (which, for an untagged file, equals the original).
 */
export async function resolveVpkIdentity(path: string, signal?: AbortSignal): Promise<VpkIdentity> {
    if (signal?.aborted) {
        throw new Error('resolveVpkIdentity aborted');
    }

    const embedded = readEmbeddedAddonInfo(path);
    if (embedded) {
        const sha = embedded.grimoireOriginalSha256;
        if (sha && SHA256_RE.test(sha)) {
            return {
                sha256: sha.toLowerCase(),
                crc32: embedded.grimoireOriginalCrc32,
                size: embedded.grimoireOriginalSize,
                source: 'embed',
                embedded,
            };
        }
    }

    if (signal?.aborted) {
        throw new Error('resolveVpkIdentity aborted');
    }

    const fp = await fingerprintFile(path);
    return { sha256: fp.sha256.toLowerCase(), size: fp.size, source: 'live' };
}

/**
 * Read and parse the embedded `addoninfo.txt` from a VPK, or null when the file
 * carries none / cannot be read. Uses the cached directory parse to detect the
 * entry cheaply (an untagged VPK has no `addoninfo.txt`, so this never opens the
 * file a second time), then pulls the entry bytes only when it is present.
 */
export function readEmbeddedAddonInfo(path: string): ParsedAddonInfo | null {
    try {
        const paths = parseVpkDirectoryCached(path);
        if (!paths) return null;
        const entry = paths.find((p) => p.replace(/\\/g, '/').toLowerCase() === ADDONINFO_ENTRY);
        if (!entry) return null;
        const bytes = readVpkEntryBytes(path, entry);
        if (!bytes) return null;
        return parseAddonInfo(bytes.toString('utf-8'));
    } catch (error) {
        console.warn(`[vpkIdentity] Failed to read embedded addoninfo.txt from ${path}:`, error);
        return null;
    }
}

/**
 * Parse a KeyValues1 AddonInfo block into a typed projection. Tolerant of the
 * Source-engine conventions: quoted or bare keys/values, escaped quotes
 * (`\"`), `//` line comments, and an optional wrapper key (`"AddonInfo" { ... }`).
 * Only flat string fields are read; nested blocks are skipped.
 */
export function parseAddonInfo(text: string): ParsedAddonInfo {
    const flat = flattenKeyValues(parseKeyValues(text));

    const num = (value: string | undefined): number | undefined => {
        if (value === undefined) return undefined;
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    };

    return {
        grimoireOriginalSha256: flat['grimoireoriginalsha256'],
        grimoireOriginalCrc32: flat['grimoireoriginalcrc32'],
        grimoireOriginalSize: num(flat['grimoireoriginalsize']),
        gamebananaId: flat['gamebananaid'],
        sourceUrl: flat['sourceurl'],
        title: flat['addontitle'],
        author: flat['addonauthor'],
        grimoireMeta: flat['grimoiremeta'],
        raw: flat,
    };
}

// --- KeyValues1 parsing -----------------------------------------------------

type KvNode = string | KvObject;
interface KvObject {
    [key: string]: KvNode;
}

interface KvToken {
    type: 'string' | 'open' | 'close';
    value: string;
}

/**
 * Tokenize a KeyValues1 document: braces, quoted strings (with `\"` / `\\`
 * escapes), and bare tokens. `//` line comments are skipped. Lenient by design;
 * malformed input yields whatever tokens could be recovered.
 */
function tokenizeKeyValues(text: string): KvToken[] {
    const tokens: KvToken[] = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
        const ch = text[i];

        // Whitespace.
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            i++;
            continue;
        }

        // Line comment.
        if (ch === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
            continue;
        }

        if (ch === '{') {
            tokens.push({ type: 'open', value: '{' });
            i++;
            continue;
        }
        if (ch === '}') {
            tokens.push({ type: 'close', value: '}' });
            i++;
            continue;
        }

        // Quoted string.
        if (ch === '"') {
            i++;
            let quoted = '';
            while (i < n && text[i] !== '"') {
                if (text[i] === '\\' && i + 1 < n) {
                    const next = text[i + 1];
                    quoted += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                    i += 2;
                    continue;
                }
                quoted += text[i];
                i++;
            }
            i++; // closing quote (or EOF)
            tokens.push({ type: 'string', value: quoted });
            continue;
        }

        // Bare token (runs until whitespace, brace, quote, or comment).
        let bare = '';
        while (i < n) {
            const c = text[i];
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '{' || c === '}' || c === '"') break;
            if (c === '/' && text[i + 1] === '/') break;
            bare += c;
            i++;
        }
        if (bare) tokens.push({ type: 'string', value: bare });
    }

    return tokens;
}

/**
 * Parse a token stream into a KeyValues object tree. A value is either a string
 * or a nested block. Unbalanced braces and dangling keys are tolerated.
 */
function parseKeyValues(text: string): KvObject {
    const tokens = tokenizeKeyValues(text);
    let pos = 0;

    const parseBlock = (): KvObject => {
        const obj: KvObject = {};
        while (pos < tokens.length) {
            const token = tokens[pos];
            if (token.type === 'close') {
                pos++;
                break;
            }
            if (token.type === 'open') {
                // Anonymous block with no key; skip its contents.
                pos++;
                parseBlock();
                continue;
            }
            // token is a key string.
            pos++;
            const next = tokens[pos];
            if (!next) {
                break;
            }
            if (next.type === 'open') {
                pos++;
                obj[token.value] = parseBlock();
            } else if (next.type === 'string') {
                pos++;
                obj[token.value] = next.value;
            } else {
                // Dangling key before a close brace.
                pos++;
            }
        }
        return obj;
    };

    return parseBlock();
}

/**
 * Flatten a KV tree to a single map of lowercased key -> string value. Walks
 * into nested blocks so a value wrapped in an `"AddonInfo" { ... }` envelope is
 * still found. On a duplicate key the first string value wins.
 */
function flattenKeyValues(node: KvObject): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (obj: KvObject): void => {
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                const lower = key.toLowerCase();
                if (!(lower in out)) out[lower] = value;
            } else {
                walk(value);
            }
        }
    };
    walk(node);
    return out;
}
