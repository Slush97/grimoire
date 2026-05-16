// Login lifecycle for Grimoire Social. Drives the Steam OpenID flow in the
// user's default browser (Steam Guard + password manager + sign-in trust all
// work best there) and waits for the grimoire://auth/done deep link to come
// back through the OS protocol handler. Persists the session token via
// Electron's ASYNC safeStorage API; on Linux without a real keychain
// (gnome-libsecret / kwallet / Portal) we refuse to persist per ADR-011.
//
// The session bearer itself lives in social.ts module memory and is set via
// social.setSessionToken. The renderer never imports either module; it talks
// to the social IPC handlers, which delegate here.

import { app, safeStorage, shell } from 'electron';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { SocialPersistenceMode, SocialSessionStatus } from '../../../src/types/social';
import {
    getAuthBeginUrl,
    getMe,
    setSessionToken,
    logout as logoutOnServer,
    SocialApiError,
} from './social';

const SESSION_FILE_NAME = 'grimoire-social-session.enc';

interface PersistedSession {
    token: string;
    expires_at: number;
}

export type PersistenceMode = SocialPersistenceMode;
export type SessionStatus = SocialSessionStatus;

let cachedUser: SessionStatus['user'] = null;
let sessionExpiresAt: number | null = null;
let cachedAvailability: boolean | null = null;

const sessionEvents = new EventEmitter();

/** Subscribe to session changes (login, logout, hydrate, server-side
 *  invalidation). Returns an unsubscribe function. */
export function onSessionChanged(listener: (status: SessionStatus) => void): () => void {
    sessionEvents.on('change', listener);
    return () => sessionEvents.off('change', listener);
}

function emitChange(): void {
    sessionEvents.emit('change', getSessionStatus());
}

/** Whether safeStorage can persist a secret on this OS WITH a real keychain
 *  behind it. On Linux this returns false if the user has no libsecret /
 *  kwallet / Portal — we refuse to persist plaintext-equivalent. */
function canPersistSecurely(): boolean {
    if (cachedAvailability !== null) return cachedAvailability;
    if (!app.isReady()) {
        // Don't latch the answer before ready; on Linux availability isn't
        // knowable until after the ready event.
        return false;
    }
    if (!safeStorage.isEncryptionAvailable()) {
        cachedAvailability = false;
        return false;
    }
    if (process.platform === 'linux') {
        const backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text' || backend === 'unknown') {
            cachedAvailability = false;
            return false;
        }
    }
    cachedAvailability = true;
    return true;
}

export function getPersistenceMode(): PersistenceMode {
    return canPersistSecurely() ? 'os-keychain' : 'session-only';
}

export function getSessionStatus(): SessionStatus {
    return {
        signedIn: cachedUser !== null,
        user: cachedUser,
        persistenceMode: getPersistenceMode(),
        expiresAt: sessionExpiresAt,
    };
}

function sessionFilePath(): string {
    return join(app.getPath('userData'), SESSION_FILE_NAME);
}

async function persistSession(shape: PersistedSession): Promise<void> {
    const encrypted = await safeStorage.encryptString(JSON.stringify(shape));
    await fs.writeFile(sessionFilePath(), encrypted);
}

async function clearPersistedSession(): Promise<void> {
    try {
        await fs.unlink(sessionFilePath());
    } catch {
        // No file or already gone — both fine.
    }
}

/** Restore an existing token from disk on app start. Called once from the
 *  app.whenReady() path. If decryption or /me both fail, the local session
 *  is cleared and the user is signed-out cleanly. */
export async function hydrateOnBoot(): Promise<void> {
    if (!canPersistSecurely()) return;
    let data: Buffer;
    try {
        data = await fs.readFile(sessionFilePath());
    } catch {
        return;
    }
    let shape: PersistedSession;
    try {
        const decrypted = await safeStorage.decryptString(data);
        shape = JSON.parse(decrypted) as PersistedSession;
    } catch (err) {
        console.warn('[socialAuth] Could not decrypt persisted session, clearing:', err);
        await clearPersistedSession();
        return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (!shape.token || shape.expires_at < nowSec + 60) {
        await clearPersistedSession();
        return;
    }
    setSessionToken(shape.token);
    sessionExpiresAt = shape.expires_at;
    try {
        const me = await getMe();
        cachedUser = me.user;
        emitChange();
    } catch (err) {
        if (err instanceof SocialApiError && err.status === 401) {
            // Server doesn't recognize the token any more; clean state.
            setSessionToken(null);
            sessionExpiresAt = null;
            await clearPersistedSession();
            return;
        }
        // Network error etc.: keep the token in memory (next /me call will
        // try again) but don't pretend we have a user yet.
        console.warn('[socialAuth] /me failed during hydrate; will retry on demand:', err);
    }
}

interface AuthCallbackParts {
    token: string;
    expiresAt: number;
    state: string | null;
}

function parseGrimoireAuthUrl(url: string): AuthCallbackParts | null {
    if (!url.toLowerCase().startsWith('grimoire://')) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    // grimoire://auth/done?token=...&expires_at=...&state=... is the canonical
    // shape. Be lenient on which segment the OS gives us — host vs first path
    // part can vary slightly across platforms when an app handles the protocol.
    const segments = [parsed.host, ...parsed.pathname.split('/')].filter(Boolean);
    if (segments[0] !== 'auth' || segments[1] !== 'done') return null;
    const token = parsed.searchParams.get('token');
    if (!token) return null;
    const expRaw = parsed.searchParams.get('expires_at');
    const expiresAt = expRaw ? Number(expRaw) : NaN;
    return {
        token,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : defaultExpiry(),
        state: parsed.searchParams.get('state'),
    };
}

/** Constant-time compare for the OAuth-style state nonce. Same shape as the
 *  Worker's compare; the strings are short hex so a non-CT compare leaks
 *  almost nothing, but we keep the pattern uniform. */
function timingSafeEqualStr(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function defaultExpiry(): number {
    return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

/** Cheap recognizer for the main-process protocol dispatcher. */
export function isGrimoireAuthUrl(url: string): boolean {
    return parseGrimoireAuthUrl(url) !== null;
}

// 10 min cap. Steam OpenID round-trips are seconds when the user is already
// logged into Steam in their browser; the long tail is Steam Guard email
// codes. Longer than this and the user has almost certainly abandoned.
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

interface ActiveLogin {
    resolve: (parts: AuthCallbackParts) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    // 32-byte hex nonce minted at login() time and round-tripped through Steam
    // + the Worker. We refuse any grimoire://auth/done URL whose state doesn't
    // match this — defends against an attacker handing the OS a crafted
    // callback URL while no real login is in flight (or while one is).
    state: string;
}

let activeLoginResolver: ActiveLogin | null = null;

/** Reject and clear the active login (if any) with the given error.
 *  Idempotent: a no-op when nothing is in flight. */
function rejectActiveLogin(err: Error): void {
    const current = activeLoginResolver;
    if (!current) return;
    activeLoginResolver = null;
    clearTimeout(current.timer);
    current.reject(err);
}

/** Cancel an in-flight external-browser sign-in. Called from the renderer via
 *  IPC when the user clicks "Cancel" on the spinner. Safe to call when no
 *  login is in progress. */
export function cancelLogin(): void {
    rejectActiveLogin(new Error('Sign-in cancelled'));
}

/** Open the Steam OpenID begin URL in the user's default browser. Resolves
 *  when grimoire://auth/done?token=... comes back through the OS protocol
 *  handler (cold-launch argv or second-instance event), or rejects on
 *  timeout / cancel. */
export async function login(): Promise<SessionStatus> {
    if (activeLoginResolver) {
        throw new Error('A Grimoire Social login is already in progress');
    }

    // 32 bytes of entropy hex-encoded (64 chars). The Worker validates the
    // shape and round-trips it through Steam's openid.return_to; we verify the
    // returned URL carries this exact value before accepting any token.
    const state = randomBytes(32).toString('hex');

    const result = await new Promise<AuthCallbackParts>((resolve, reject) => {
        const timer = setTimeout(() => {
            rejectActiveLogin(
                new Error(
                    'Sign-in timed out. Finish in your browser and try again, or cancel and retry.'
                )
            );
        }, LOGIN_TIMEOUT_MS);
        activeLoginResolver = { resolve, reject, timer, state };

        const beginUrl = `${getAuthBeginUrl()}?state=${encodeURIComponent(state)}`;
        shell.openExternal(beginUrl).catch((err) => {
            rejectActiveLogin(err instanceof Error ? err : new Error(String(err)));
        });
    });

    setSessionToken(result.token);
    sessionExpiresAt = result.expiresAt;
    if (canPersistSecurely()) {
        try {
            await persistSession({ token: result.token, expires_at: result.expiresAt });
        } catch (err) {
            console.warn('[socialAuth] Failed to persist session, continuing in-memory:', err);
        }
    }

    try {
        const me = await getMe();
        cachedUser = me.user;
    } catch (err) {
        // /me failed right after a successful auth — drop the token so the UI
        // doesn't pretend we're signed in.
        setSessionToken(null);
        sessionExpiresAt = null;
        await clearPersistedSession();
        emitChange();
        throw err;
    }

    emitChange();
    return getSessionStatus();
}

/** Local + remote sign-out. Best-effort calls /v1/auth/logout, then clears
 *  the persisted session file regardless of network result. */
export async function logout(): Promise<SessionStatus> {
    try {
        await logoutOnServer();
    } catch {
        // logoutOnServer already swallows expected errors; this is a safety net.
    }
    cachedUser = null;
    sessionExpiresAt = null;
    setSessionToken(null);
    await clearPersistedSession();
    emitChange();
    return getSessionStatus();
}

/** Called after a successful DELETE /v1/me so the local state matches.
 *  Distinct from logout() because the server has already invalidated. */
export async function clearLocalAfterAccountDeletion(): Promise<void> {
    cachedUser = null;
    sessionExpiresAt = null;
    setSessionToken(null);
    await clearPersistedSession();
    emitChange();
}

/** Handle a grimoire://auth/done URL that arrived via the OS protocol
 *  handler (cold-launch argv or second-instance event). This is the return
 *  path for the external-browser sign-in flow.
 *
 *  CSRF defense: we ONLY accept the callback when (a) a login() is in flight
 *  AND (b) the URL's state matches the nonce we minted for that login. Any
 *  other shape — including a callback that arrives when nothing is in flight,
 *  which used to be silently accepted — is dropped. Without this, a victim
 *  who clicks an attacker-crafted grimoire://auth/done?token=... URL would
 *  unknowingly adopt the attacker's session. */
export async function handleProtocolAuthCallback(url: string): Promise<void> {
    const parts = parseGrimoireAuthUrl(url);
    if (!parts) return;
    const current = activeLoginResolver;
    if (!current) {
        console.warn('[socialAuth] dropping auth callback with no active login');
        return;
    }
    if (!parts.state || !timingSafeEqualStr(parts.state, current.state)) {
        // Mismatch could be a race (stale callback from a previous abandoned
        // login) or a CSRF attempt. Either way: reject loudly enough to log
        // but don't reveal which case it was.
        rejectActiveLogin(
            new Error('Sign-in callback did not match this login. Try again.')
        );
        return;
    }
    activeLoginResolver = null;
    clearTimeout(current.timer);
    current.resolve(parts);
}
