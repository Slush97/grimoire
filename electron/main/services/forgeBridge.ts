/**
 * Loopback HTTP bridge for DeadlockForge 1-click installs.
 *
 * DeadlockForge forges VPKs client-side, so there is no hosted URL to pass
 * through the `grimoire://` protocol. This listener lets the site hand us the
 * bytes it already has:
 *
 *   GET  /forge/v1/ping     -> minimal liveness probe so the site can light up
 *                              its button only when Grimoire is actually here
 *   POST /forge/v1/install  -> raw .vpk body, install after user confirmation
 *
 * Security posture, in short:
 *  - binds 127.0.0.1 only, never a routable interface
 *  - exact-match Origin allowlist, missing Origin rejected
 *  - Host header pinned to loopback (anti-DNS-rebinding)
 *  - Content-Type + custom header force a CORS preflight on every install
 *  - write-only surface: ping leaks no user data, there are no read endpoints
 *  - off by default, behind a settings toggle
 *  - user confirmation dialog before anything touches disk
 *  - one outstanding confirmation, plus a per-origin cooldown
 *  - size envelope enforced on real bytes received, not the declared length
 *  - VPK magic verified before install
 *
 * See `forgeProtocol.ts` for the rule-by-rule rationale.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';

import {
    FORGE_AUTHOR_HEADER,
    FORGE_INSTALL_PATH,
    FORGE_MAX_AUTHOR_LENGTH,
    FORGE_MAX_BYTES,
    FORGE_MAX_NAME_LENGTH,
    FORGE_MIN_BYTES,
    FORGE_NAME_HEADER,
    FORGE_PING_PATH,
    FORGE_PORT_RANGE,
    FORGE_PROTOCOL_HEADER,
    FORGE_PROTOCOL_VERSION,
    FORGE_TYPE_HEADER,
    decodeHeaderValue,
    hasVpkMagic,
    normalizeForgeType,
    sanitizeForgeString,
    validateDeclaredLength,
    validateHost,
    validateInstallHeaders,
    validateOrigin,
    type ForgeRejection,
} from './forgeProtocol';
import { loadSettings, saveSettings } from './settings';

/** Time a confirmation dialog may sit unanswered before we give up. */
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

/** Minimum gap between accepted install requests from one origin. Blunts
 *  dialog-fatigue attacks that spam prompts hoping for one stray click. */
const ORIGIN_COOLDOWN_MS = 3000;

/** Header/idle timeouts. Keeps a stalled or slowloris-style client from
 *  holding a connection open indefinitely. */
const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** Concurrent sockets. The site opens one at a time; this is purely a cap. */
const MAX_CONNECTIONS = 8;

export interface ForgeInstallRequest {
    requestId: string;
    /** Sanitized display name, safe to render. */
    name: string;
    /** Sanitized author, or undefined when the site did not send one. */
    author?: string;
    /** Advisory category (sound/texture/itemart/hud), or undefined. */
    type?: string;
    /** Bytes actually received. Never the caller's claimed size. */
    sizeBytes: number;
    /** Validated origin, shown in the dialog as the provenance line. */
    origin: string;
    /** Absolute path to the verified temp file awaiting install. */
    tempPath: string;
}

/** Injected by index.ts so this service does not import the install pipeline
 *  directly (keeps the dependency direction one-way and the unit tests light). */
export type ForgeInstallHandler = (request: ForgeInstallRequest) => Promise<void>;

let server: Server | null = null;
let boundPort: number | null = null;
/** Non-null while a start is in flight, so overlapping calls await it rather
 *  than racing to bind a second socket. */
let startInFlight: Promise<void> | null = null;
let installHandler: ForgeInstallHandler | null = null;
let getMainWindow: (() => BrowserWindow | null) | null = null;

/** Exactly one confirmation may be outstanding at a time. */
let pendingConfirm: {
    requestId: string;
    resolve: (accepted: boolean) => void;
    timer: NodeJS.Timeout;
} | null = null;

/** origin -> timestamp of the last accepted request. */
const lastAcceptedByOrigin = new Map<string, number>();

/** True from the moment an install request claims the slot until it finishes.
 *  Set synchronously so concurrent requests cannot both get past the check. */
let installInFlight = false;

/** True while the opt-in prompt is on screen. */
let enablePromptOpen = false;

/** Set once the user has said no this run. Cleared only by restarting the app,
 *  so a page cannot re-ask in a loop. Settings still offers the toggle. */
let enableDeclinedThisSession = false;

export function getForgeBridgePort(): number | null {
    return boundPort;
}

/**
 * Write the CORS headers for an allowlisted origin.
 *
 * `Access-Control-Allow-Private-Network` is required by Chrome's Private
 * Network Access rules: a public HTTPS page reaching a loopback address must
 * receive it on the preflight or the actual request is blocked. Loopback is
 * already exempt from mixed-content blocking, so no HTTPS listener is needed.
 */
function writeCorsHeaders(res: ServerResponse, origin: string): void {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        `Content-Type, ${FORGE_PROTOCOL_HEADER}, ${FORGE_NAME_HEADER}, ${FORGE_AUTHOR_HEADER}, ${FORGE_TYPE_HEADER}`
    );
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
    // Responses are origin-specific, so make that explicit for any cache.
    res.setHeader('Vary', 'Origin');
}

/** Terse JSON reply. No request data is ever echoed back. */
function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
    });
    res.end(payload);
}

function sendRejection(res: ServerResponse, rejection: ForgeRejection): void {
    sendJson(res, rejection.status, { error: rejection.reason });
}

/**
 * Ask the renderer to show the confirmation dialog and wait for an answer.
 *
 * Any page can in principle reach a loopback port, so this dialog is the real
 * security boundary. It shows only values we control or have sanitized, and
 * the size is the byte count we measured ourselves.
 */
function awaitConfirmation(request: ForgeInstallRequest): Promise<boolean> {
    const window = getMainWindow?.() ?? null;
    // isDestroyed as well as null: a window torn down mid-install still
    // satisfies the null check, and sending to it throws.
    if (!window || window.isDestroyed()) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            if (pendingConfirm?.requestId === request.requestId) {
                pendingConfirm = null;
                resolve(false);
            }
        }, CONFIRM_TIMEOUT_MS);

        pendingConfirm = { requestId: request.requestId, resolve, timer };

        window.webContents.send('forge-install-request', {
            requestId: request.requestId,
            name: request.name,
            author: request.author,
            type: request.type,
            sizeBytes: request.sizeBytes,
            origin: request.origin,
        });
    });
}

/**
 * Ask the user whether to switch the bridge on.
 *
 * Triggered by the `grimoire://forge/launch` URL the site fires when it cannot
 * find the bridge, so opting in happens where the user already is instead of
 * requiring them to find a checkbox in Settings.
 *
 * Two honesty constraints shape this. First, a protocol URL carries no
 * verifiable origin: any page can fire it, so the prompt must not claim a
 * specific site asked. Second, saying yes only opens the listener. It does not
 * install anything: the origin allowlist still gates who may talk to it, and
 * every install still goes through its own confirmation. So the worst outcome
 * of a mistaken yes is an open loopback port that only deadlockforge.net can
 * use.
 */
export function requestForgeEnable(): void {
    if (loadSettings().forgeLocalInstallEnabled) return;
    // One prompt at a time, and drop it entirely for the rest of the session
    // once declined, so repeated protocol fires cannot nag the user into it.
    if (enablePromptOpen || enableDeclinedThisSession) return;

    const window = getMainWindow?.() ?? null;
    if (!window) return;

    enablePromptOpen = true;
    window.webContents.send('forge-enable-request');
}

/** Called from the IPC layer when the user answers the opt-in prompt. */
export async function resolveForgeEnable(accepted: boolean): Promise<void> {
    if (!enablePromptOpen) return;
    enablePromptOpen = false;

    if (!accepted) {
        enableDeclinedThisSession = true;
        return;
    }

    saveSettings({ ...loadSettings(), forgeLocalInstallEnabled: true });
    await syncForgeBridgeWithSettings();
}

/** Called from the IPC layer when the user answers the dialog. */
export function resolveForgeInstallConfirmation(requestId: string, accepted: boolean): void {
    if (!pendingConfirm || pendingConfirm.requestId !== requestId) return;
    clearTimeout(pendingConfirm.timer);
    const { resolve } = pendingConfirm;
    pendingConfirm = null;
    resolve(accepted);
}

/**
 * Stream the request body to a temp file, enforcing the size cap on bytes
 * actually received.
 *
 * Streaming rather than buffering means a 512 MB payload never sits in the
 * main process heap, and the cap is checked continuously so a caller that
 * understates its `Content-Length` is cut off mid-transfer rather than after
 * the fact.
 */
async function streamBodyToTempFile(
    req: IncomingMessage,
    tempPath: string
): Promise<{ ok: true; size: number } | { ok: false; reason: 'TOO_LARGE' | 'ABORTED' }> {
    return new Promise((resolve) => {
        const out = createWriteStream(tempPath);
        let received = 0;
        let settled = false;

        const finish = (result: { ok: true; size: number } | { ok: false; reason: 'TOO_LARGE' | 'ABORTED' }) => {
            if (settled) return;
            settled = true;
            out.close(() => resolve(result));
        };

        req.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > FORGE_MAX_BYTES) {
                req.destroy();
                finish({ ok: false, reason: 'TOO_LARGE' });
                return;
            }
            // Respect backpressure: without pausing, a fast sender outruns the
            // disk and the unwritten chunks queue up in the main process heap,
            // which is exactly what streaming to a file is meant to avoid.
            if (!out.write(chunk)) {
                req.pause();
                out.once('drain', () => req.resume());
            }
        });

        req.on('end', () => {
            out.end(() => finish({ ok: true, size: received }));
        });

        req.on('error', () => finish({ ok: false, reason: 'ABORTED' }));
        out.on('error', () => finish({ ok: false, reason: 'ABORTED' }));
    });
}

async function safeUnlink(path: string): Promise<void> {
    await fs.unlink(path).catch(() => { });
}

async function handleInstall(
    req: IncomingMessage,
    res: ServerResponse,
    origin: string
): Promise<void> {
    const headerCheck = validateInstallHeaders(
        req.headers['content-type'],
        req.headers[FORGE_PROTOCOL_HEADER] as string | undefined
    );
    if (headerCheck !== true) {
        sendRejection(res, headerCheck);
        return;
    }

    const lengthCheck = validateDeclaredLength(req.headers['content-length']);
    if (lengthCheck !== true) {
        sendRejection(res, lengthCheck);
        return;
    }

    // Claim the slot synchronously, before the first await.
    //
    // Testing pendingConfirm alone was racy: it is only set once the body has
    // finished streaming, so two requests arriving together both passed the
    // check, both streamed a temp file, and the loser's file was orphaned when
    // the winner replaced pendingConfirm. The per-origin cooldown does not
    // serialize them either, since the apex and www origins are distinct keys.
    if (installInFlight || pendingConfirm) {
        sendRejection(res, { ok: false, reason: 'BUSY', status: 429 });
        return;
    }
    installInFlight = true;

    const requestId = randomUUID();
    const tempPath = join(tmpdir(), `grimoire-forge-${requestId}.vpk`);
    // Single owner for the temp file: every exit path below runs this, so no
    // branch can leave a half-gigabyte file behind.
    let tempPathToClean: string | null = tempPath;

    try {
        const lastAccepted = lastAcceptedByOrigin.get(origin) ?? 0;
        if (Date.now() - lastAccepted < ORIGIN_COOLDOWN_MS) {
            sendRejection(res, { ok: false, reason: 'COOLDOWN', status: 429 });
            return;
        }
        lastAcceptedByOrigin.set(origin, Date.now());

        const body = await streamBodyToTempFile(req, tempPath);
        if (!body.ok) {
            if (body.reason === 'TOO_LARGE') {
                sendRejection(res, { ok: false, reason: 'TOO_LARGE', status: 413 });
            }
            return;
        }

        if (body.size < FORGE_MIN_BYTES) {
            sendRejection(res, { ok: false, reason: 'TOO_SMALL', status: 400 });
            return;
        }

        // Verify this is really a VPK before the user is even asked, so the
        // dialog never describes something we would refuse to install anyway.
        const handle = await fs.open(tempPath, 'r');
        const head = Buffer.alloc(4);
        try {
            await handle.read(head, 0, 4, 0);
        } finally {
            await handle.close();
        }
        if (!hasVpkMagic(head)) {
            sendRejection(res, { ok: false, reason: 'NOT_A_VPK', status: 400 });
            return;
        }

        const name =
            sanitizeForgeString(
                decodeHeaderValue(req.headers[FORGE_NAME_HEADER] as string | undefined),
                FORGE_MAX_NAME_LENGTH
            ) || 'DeadlockForge mod';
        const author =
            sanitizeForgeString(
                decodeHeaderValue(req.headers[FORGE_AUTHOR_HEADER] as string | undefined),
                FORGE_MAX_AUTHOR_LENGTH
            ) || undefined;
        const type = normalizeForgeType(req.headers[FORGE_TYPE_HEADER] as string | undefined);

        const request: ForgeInstallRequest = {
            requestId,
            name,
            author,
            type,
            sizeBytes: body.size,
            origin,
            tempPath,
        };

        // Answer the site immediately and do the install behind the dialog. The
        // site gets no success/failure signal by design: it learns nothing about
        // the user's setup, and there is no oracle to probe.
        sendJson(res, 202, { status: 'pending-confirm' });

        const accepted = await awaitConfirmation(request);
        if (!accepted) return;

        try {
            await installHandler?.(request);
        } catch (err) {
            console.error('[forgeBridge] Install failed:', err);
            // The modal has already closed by now, so a console line is invisible
            // to the user. Mirror the other install paths and let the UI toast it.
            getMainWindow?.()?.webContents.send('forge-install-failed', {
                name: request.name,
            });
        }
    } finally {
        installInFlight = false;
        if (tempPathToClean) {
            const path = tempPathToClean;
            tempPathToClean = null;
            await safeUnlink(path);
        }
    }
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Re-read settings per request so toggling the kill switch takes effect
    // immediately, without needing a restart.
    if (!loadSettings().forgeLocalInstallEnabled) {
        sendRejection(res, { ok: false, reason: 'BRIDGE_DISABLED', status: 403 });
        return;
    }

    // Unpackaged builds additionally accept localhost, so the DeadlockForge
    // side can be developed against a local server. A shipped build never does,
    // regardless of any user setting.
    const originCheck = validateOrigin(req.headers.origin, {
        allowDevOrigins: !app.isPackaged,
    });
    if (!originCheck.ok) {
        // Note: no CORS headers on a rejection, so a disallowed page cannot
        // read this response either.
        sendRejection(res, originCheck);
        return;
    }
    const { origin } = originCheck;

    const hostCheck = validateHost(req.headers.host, boundPort ?? 0);
    if (hostCheck !== true) {
        sendRejection(res, hostCheck);
        return;
    }

    writeCorsHeaders(res, origin);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const path = (req.url ?? '').split('?')[0];

    if (req.method === 'GET' && path === FORGE_PING_PATH) {
        // Deliberately minimal. No version string, no game path, no mod counts,
        // no username: any site that gets past the origin check learns only
        // that Grimoire is running and willing to accept an install.
        sendJson(res, 200, { app: 'grimoire', protocol: FORGE_PROTOCOL_VERSION, ready: true });
        return;
    }

    if (req.method === 'POST' && path === FORGE_INSTALL_PATH) {
        // Nothing above this awaits the handler, so an unhandled rejection here
        // would take down the main process. Everything is best-effort from the
        // caller's point of view: the site is told nothing either way.
        void handleInstall(req, res, origin).catch((err) => {
            console.error('[forgeBridge] Install handler threw:', err);
            if (!res.headersSent) {
                sendRejection(res, { ok: false, reason: 'INTERNAL', status: 500 });
            }
        });
        return;
    }

    sendRejection(res, { ok: false, reason: 'NOT_FOUND', status: 404 });
}

/** Try each candidate port until one binds. */
function listenOnFirstFreePort(httpServer: Server, ports: readonly number[]): Promise<number | null> {
    return new Promise((resolve) => {
        let index = 0;

        const tryNext = (): void => {
            if (index >= ports.length) {
                resolve(null);
                return;
            }
            const port = ports[index++]!;

            const onError = (): void => {
                httpServer.removeListener('listening', onListening);
                tryNext();
            };
            const onListening = (): void => {
                httpServer.removeListener('error', onError);
                resolve(port);
            };

            httpServer.once('error', onError);
            httpServer.once('listening', onListening);
            // Binding the loopback address explicitly is the single most
            // important line in this file: omitting the host argument would
            // listen on every interface and expose the bridge to the LAN.
            httpServer.listen(port, '127.0.0.1');
        };

        tryNext();
    });
}

/**
 * Register the install handler and window accessor.
 *
 * Called once at startup regardless of the toggle, so a later settings change
 * can bring the listener up without needing these passed in again.
 */
export function configureForgeBridge(
    handler: ForgeInstallHandler,
    mainWindowGetter: () => BrowserWindow | null
): void {
    installHandler = handler;
    getMainWindow = mainWindowGetter;
}

/**
 * Start the bridge if the user has enabled it.
 *
 * The listener does not exist at all while the toggle is off, so the attack
 * surface for the large majority of users who never touch DeadlockForge is
 * exactly zero.
 */
export async function startForgeBridge(): Promise<void> {
    // Serialize on the in-flight start rather than on `server`, which is only
    // assigned after the bind resolves: two overlapping calls would otherwise
    // both get past the guard, bind two sockets, and leave one of them
    // unreachable to stopForgeBridge (so the kill switch could not close it).
    if (startInFlight) {
        await startInFlight;
        return;
    }
    if (server) return;

    startInFlight = (async () => {
        if (!loadSettings().forgeLocalInstallEnabled) return;
        if (!installHandler) {
            console.warn('[forgeBridge] configureForgeBridge() not called, refusing to start');
            return;
        }

        const httpServer = createServer(handleRequest);
        httpServer.maxConnections = MAX_CONNECTIONS;
        httpServer.headersTimeout = HEADERS_TIMEOUT_MS;
        httpServer.requestTimeout = REQUEST_TIMEOUT_MS;

        const port = await listenOnFirstFreePort(httpServer, FORGE_PORT_RANGE);
        if (port === null) {
            console.warn('[forgeBridge] No free port in range, bridge not started');
            httpServer.close();
            return;
        }

        server = httpServer;
        boundPort = port;
        console.log(`[forgeBridge] Listening on 127.0.0.1:${port}`);
    })();

    try {
        await startInFlight;
    } finally {
        startInFlight = null;
    }
}

export async function stopForgeBridge(): Promise<void> {
    if (!server) return;
    const httpServer = server;
    server = null;
    boundPort = null;
    if (pendingConfirm) {
        clearTimeout(pendingConfirm.timer);
        pendingConfirm.resolve(false);
        pendingConfirm = null;
    }
    lastAcceptedByOrigin.clear();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    console.log('[forgeBridge] Stopped');
}

/**
 * Bring the listener in line with the current setting.
 *
 * Called after any settings save so flipping the kill switch takes effect
 * immediately: switching it off closes the socket rather than merely refusing
 * requests on it.
 */
export async function syncForgeBridgeWithSettings(): Promise<void> {
    const enabled = loadSettings().forgeLocalInstallEnabled;
    if (enabled && !server) {
        await startForgeBridge();
    } else if (!enabled && server) {
        await stopForgeBridge();
    }
}

