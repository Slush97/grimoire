/**
 * Pure protocol/validation layer for the DeadlockForge local install bridge.
 *
 * Kept free of Electron and Node filesystem imports so every rule here is
 * directly unit-testable. The socket handling lives in `forgeBridge.ts`.
 *
 * Design note: DeadlockForge builds VPKs in the browser on demand, so there is
 * no CDN URL to hand us the way GameBanana does. Instead of asking the site to
 * host user-generated binaries, the page POSTs the bytes it already holds to a
 * loopback listener. That removes the "trusted hostname" anchor the
 * `grimoire://` flow relies on, so the trust rules are rebuilt here.
 */

/** Protocol version carried in the required custom header. */
export const FORGE_PROTOCOL_VERSION = 1;

/** Ports probed by the site, in order. First free one wins. */
export const FORGE_PORT_RANGE = [43110, 43111, 43112, 43113, 43114] as const;

export const FORGE_PING_PATH = '/forge/v1/ping';
export const FORGE_INSTALL_PATH = '/forge/v1/install';

/** Required on install requests. Both of these are "non-simple" values, which
 *  is what forces the browser through a CORS preflight (see below). */
export const FORGE_CONTENT_TYPE = 'application/octet-stream';
export const FORGE_PROTOCOL_HEADER = 'x-forge-protocol';

export const FORGE_NAME_HEADER = 'x-forge-name';
export const FORGE_AUTHOR_HEADER = 'x-forge-author';
export const FORGE_TYPE_HEADER = 'x-forge-type';

/**
 * Origins allowed to talk to the bridge. Exact string match, no wildcards, no
 * suffix matching: `deadlockforge.net.evil.com` must never pass.
 */
export const ALLOWED_FORGE_ORIGINS = new Set<string>([
    'https://deadlockforge.net',
    'https://www.deadlockforge.net',
]);

/**
 * Extra origins accepted only in unpackaged (development) builds.
 *
 * Working on the DeadlockForge side means serving the site from localhost, and
 * an origin allowlist that cannot be satisfied locally would make the feature
 * untestable without editing this file.
 *
 * Deliberately keyed off `app.isPackaged` rather than a user-facing setting:
 * a shipped build can never accept these no matter what the user has toggled,
 * and a developer never has to remember to turn anything on.
 */
export const DEV_FORGE_ORIGIN_PATTERN =
    /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/**
 * Size envelope for an accepted VPK body.
 *
 * The ceiling is deliberately generous. SoundForge output scales with both the
 * number of replaced sounds and the length of the replacement clip: measured on
 * deadlockforge.net it runs at roughly 16 KB per second of audio per sound, so
 * a 600-sound build (the site's own per-build cap) reaches ~103 MB from a 10
 * second clip and ~287 MB from a 30 second one. A tighter cap would reject
 * real mods rather than only abusive ones.
 *
 * Memory is not the constraint: the body streams to a temp file with
 * backpressure, so the ceiling bounds disk use rather than heap.
 */
export const FORGE_MIN_BYTES = 1024;
export const FORGE_MAX_BYTES = 512 * 1024 * 1024;

/** Display caps, mirroring the `grimoire://install/v1` spec. */
export const FORGE_MAX_NAME_LENGTH = 120;
export const FORGE_MAX_AUTHOR_LENGTH = 60;

/** VPK directory header magic: 0x55AA1234 little-endian at offset 0. */
export const VPK_MAGIC = 0x55aa1234;

export type ForgeRejectReason =
    | 'BRIDGE_DISABLED'
    | 'BAD_ORIGIN'
    | 'BAD_HOST'
    | 'BAD_CONTENT_TYPE'
    | 'BAD_PROTOCOL_HEADER'
    | 'BAD_METHOD'
    | 'NOT_FOUND'
    | 'TOO_LARGE'
    | 'TOO_SMALL'
    | 'NOT_A_VPK'
    | 'BUSY'
    | 'COOLDOWN'
    | 'INTERNAL';

export interface ForgeRejection {
    ok: false;
    reason: ForgeRejectReason;
    /** HTTP status to answer with. Deliberately terse; no detail is echoed
     *  back to the caller beyond this code. */
    status: number;
}

export interface ForgeOriginAccepted {
    ok: true;
    origin: string;
}

/**
 * Validate the `Origin` header against the allowlist.
 *
 * A missing Origin is rejected outright. Browsers always send it on
 * cross-origin requests, so absence means either a non-browser client or a
 * same-origin request that cannot exist here (nothing is served on this
 * listener). Treating "missing" as "allowed" is the classic mistake that makes
 * a loopback bridge trivially reachable by curl.
 *
 * Caveat worth stating plainly: `Origin` is only meaningful when the client is
 * a browser. A local process running as the user can forge it. That is
 * acceptable because such a process can already write to the addons folder
 * directly, so the bridge grants it nothing new. This is exactly why the
 * listener stays write-only and why the confirmation dialog, not this check,
 * is the real security boundary.
 */
export function validateOrigin(
    origin: string | undefined,
    { allowDevOrigins = false }: { allowDevOrigins?: boolean } = {}
): ForgeOriginAccepted | ForgeRejection {
    if (!origin) {
        return { ok: false, reason: 'BAD_ORIGIN', status: 403 };
    }
    if (ALLOWED_FORGE_ORIGINS.has(origin)) {
        return { ok: true, origin };
    }
    if (allowDevOrigins && DEV_FORGE_ORIGIN_PATTERN.test(origin)) {
        return { ok: true, origin };
    }
    return { ok: false, reason: 'BAD_ORIGIN', status: 403 };
}

/**
 * Validate the `Host` header points at loopback.
 *
 * This is the anti-DNS-rebinding check: an attacker can point `evil.com` at
 * 127.0.0.1 so the browser connects to us, but the Host header then carries
 * their domain rather than the loopback literal. The Origin check already
 * covers that case; this is defence in depth for the same attack.
 */
export function validateHost(host: string | undefined, port: number): true | ForgeRejection {
    if (!host) {
        return { ok: false, reason: 'BAD_HOST', status: 403 };
    }
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!allowed.includes(host.toLowerCase())) {
        return { ok: false, reason: 'BAD_HOST', status: 403 };
    }
    return true;
}

/**
 * Validate the headers that force a CORS preflight.
 *
 * This is the load-bearing check of the whole design. CORS governs whether JS
 * may *read* a response, not whether the request *arrives*. A "simple request"
 * (POST with a Content-Type of text/plain, multipart/form-data or
 * application/x-www-form-urlencoded) is dispatched with no preflight at all,
 * so a hostile page could fire a VPK at us and simply not care that it cannot
 * read the reply.
 *
 * Requiring `application/octet-stream` plus a custom header makes every
 * install request non-simple, so the browser must send an OPTIONS preflight
 * first. We refuse the preflight for non-allowlisted origins, and the POST is
 * then never sent.
 */
export function validateInstallHeaders(
    contentType: string | undefined,
    protocolHeader: string | undefined
): true | ForgeRejection {
    // Tolerate parameters (`application/octet-stream; charset=binary`) but
    // require the base type to match exactly.
    const baseType = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (baseType !== FORGE_CONTENT_TYPE) {
        return { ok: false, reason: 'BAD_CONTENT_TYPE', status: 415 };
    }
    if ((protocolHeader ?? '').trim() !== String(FORGE_PROTOCOL_VERSION)) {
        return { ok: false, reason: 'BAD_PROTOCOL_HEADER', status: 400 };
    }
    return true;
}

/**
 * Strip anything from a caller-supplied display string that could be used to
 * misrepresent the confirmation dialog.
 *
 * Removes C0/C1 control characters, newlines, bidirectional overrides and
 * zero-width characters. Bidi overrides matter: without stripping them a name
 * can be made to render right-to-left and disguise what is being installed.
 * Truncates rather than rejects so an over-long name is a cosmetic problem,
 * never a failed install.
 */
export function sanitizeForgeString(raw: string | undefined, maxLength: number): string {
    if (!raw) return '';
    const cleaned = raw
        // C0 controls, DEL, C1 controls
        // eslint-disable-next-line no-control-regex -- stripping control characters is the point
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
        // bidi embedding/override/isolate controls
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
        // zero-width and word joiner
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .trim();
    return cleaned.slice(0, maxLength);
}

/**
 * Decode a header value that the site sent percent-encoded.
 *
 * Mod names routinely contain non-ASCII characters, which are not legal in raw
 * HTTP header values, so the site encodes them. A malformed encoding is
 * downgraded to the raw string rather than failing the install.
 */
export function decodeHeaderValue(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/** Advisory categorisation only. Unknown values are dropped, never rejected. */
const KNOWN_FORGE_TYPES = new Set(['sound', 'texture', 'itemart', 'hud']);

export function normalizeForgeType(raw: string | undefined): string | undefined {
    const value = (raw ?? '').trim().toLowerCase();
    return KNOWN_FORGE_TYPES.has(value) ? value : undefined;
}

/**
 * Check the declared `Content-Length` before a single byte is read.
 *
 * The real byte count is enforced again while streaming, because a caller can
 * lie here. This is the cheap early-out that stops us buying a 4 GB transfer.
 */
export function validateDeclaredLength(contentLength: string | undefined): true | ForgeRejection {
    if (contentLength === undefined) {
        // No length means we cannot pre-check, so fall through to the
        // mid-stream cap. Not an error on its own.
        return true;
    }
    const parsed = Number(contentLength);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, reason: 'TOO_LARGE', status: 413 };
    }
    if (parsed > FORGE_MAX_BYTES) {
        return { ok: false, reason: 'TOO_LARGE', status: 413 };
    }
    if (parsed > 0 && parsed < FORGE_MIN_BYTES) {
        return { ok: false, reason: 'TOO_SMALL', status: 400 };
    }
    return true;
}

/**
 * Confirm the payload is actually a VPK before it goes anywhere near the game
 * folder. Cheap, and it means a mistyped or hostile upload cannot land a file
 * of some other format in the addons directory.
 */
export function hasVpkMagic(head: Buffer): boolean {
    if (head.length < 4) return false;
    return head.readUInt32LE(0) === VPK_MAGIC;
}

/**
 * Windows reserved device names. Creating `con.vpk` fails on Windows no matter
 * which directory it is in, because the reservation applies to the stem rather
 * than the full filename.
 */
const WINDOWS_RESERVED_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Build a safe, human-meaningful filename stem for the installed VPK.
 *
 * Anything reaching the filesystem goes through the same lowercase slug rule
 * the rest of the app uses, so a display name can never introduce path
 * separators, traversal sequences or reserved characters. Reserved Windows
 * device names are suffixed rather than rejected, so a mod legitimately called
 * "Aux" still installs instead of failing on one platform only.
 */
export function forgeFileNameStem(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
    if (slug.length === 0) return 'deadlockforge_mod';
    return WINDOWS_RESERVED_NAMES.has(slug) ? `${slug}_mod` : slug;
}
