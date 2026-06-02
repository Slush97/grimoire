/**
 * Discord Rich Presence.
 *
 * Shows "what you're doing in Grimoire" on the user's Discord profile, e.g.
 *   Grimoire
 *   Managing their mods
 *   8 mods installed
 *   for 12:04   [Get Grimoire] [Join the Discord]
 *
 * Trust pillar: this talks ONLY to the user's locally-running Discord client
 * over an IPC socket ($XDG_RUNTIME_DIR/discord-ipc-0 on Linux, a named pipe on
 * Windows). Grimoire itself opens no network connection and sends nothing to
 * any Grimoire server. It is opt-in and off by default (settings.discordRpcEnabled).
 *
 * The renderer reports a tiny context object on navigation; this module owns
 * all the presence wording, art keys, buttons, the elapsed timer, the connect
 * lifecycle, and the rate-limit throttle. The renderer never sees the client id
 * (it isn't a secret, just kept here as the single source of truth).
 */
import { Client, type SetActivity } from '@xhayper/discord-rpc';

/**
 * The Discord Application ID that owns Rich Presence for Grimoire. This is the
 * SAME application that owns the grimoire-discord-setup bot (Developer Portal ->
 * the app -> Application ID). It is a PUBLIC, non-secret value, safe to ship in
 * client source. Blanking it is the kill switch: an empty string makes every
 * call below no-op.
 *
 * The one portal step left before the art renders is uploading the logo as the
 * `grimoire_logo` Rich Presence asset. See docs/discord-rpc-setup.md.
 */
const DISCORD_CLIENT_ID = '1504228345922191380';

/** Art asset key uploaded under the app's Rich Presence -> Art Assets. */
const LARGE_IMAGE_KEY = 'grimoire_logo';

/** Buttons rendered on the presence card (max 2). https URLs required. */
const BUTTONS: NonNullable<SetActivity['buttons']> = [
    { label: 'Get Grimoire', url: 'https://grimoiremods.com' },
    { label: 'Join the Discord', url: 'https://discord.gg/KgYGHEMq2P' },
];

/** Context the renderer reports for the current surface. */
export interface PresenceContext {
    /** First path segment of the route, e.g. 'installed', 'browse', 'locker'. */
    surface: string;
    /** Installed mod count, used by the Installed surface. */
    count?: number;
    /** Display name of the hero open in the Locker (e.g. "Abrams"), if any.
     *  Drives the per-hero art + "Customizing <hero>" line. */
    hero?: string;
}

/**
 * Hero display name -> Deadlock wiki file name, only where they differ. Every
 * other hero is just spaces -> underscores ("Lady Geist" -> "Lady_Geist").
 */
const HERO_WIKI_FILE_OVERRIDES: Record<string, string> = {
    Doorman: 'The_Doorman',
};

/**
 * Public hero icon URL, served by the Deadlock wiki (the same source the
 * build-time hero-icon fetch uses). `Special:FilePath` 302-redirects to the CDN
 * PNG, which Discord's external-image proxy resolves and caches. Passed as the
 * activity's `large_url` so no per-hero art needs uploading to the portal.
 */
function heroIconUrl(name: string): string {
    const base = HERO_WIKI_FILE_OVERRIDES[name] ?? name.trim().replace(/\s+/g, '_');
    return `https://deadlock.wiki/Special:FilePath/${encodeURIComponent(base)}.png`;
}

type SurfaceText = { details: string; state?: string };

/**
 * Per-surface wording. Kept English on purpose: Discord Rich Presence is
 * conventionally English and these strings live outside the app's i18n catalog.
 * `{count}` in a state string is filled from PresenceContext.count.
 */
const SURFACE_PRESENCE: Record<string, SurfaceText> = {
    installed: { details: 'Managing their mods', state: '{count} mods installed' },
    browse: { details: 'Browsing GameBanana', state: 'Hunting for mods' },
    discover: { details: 'Browsing the community', state: 'Looking through shared profiles' },
    locker: { details: 'In the Hero Locker', state: 'Organizing skins' },
    conflicts: { details: 'Resolving mod conflicts' },
    profiles: { details: 'Managing mod profiles' },
    crosshair: { details: 'Designing a crosshair' },
    autoexec: { details: 'Editing the autoexec' },
    stats: { details: 'Checking their stats' },
    settings: { details: 'Tweaking settings' },
};

const FALLBACK_PRESENCE: SurfaceText = { details: 'In the mod manager' };

/**
 * Session start, captured when the main process first loads this module, so the
 * "elapsed" timer reads as one continuous session ("for 1:23:45") instead of
 * resetting every time the user navigates.
 */
const SESSION_START = Date.now();

/** Discord allows 5 activity updates / 20s (one per 4s). 4.5s keeps us under
 *  that ceiling even when the user navigates continuously. */
const MIN_UPDATE_INTERVAL_MS = 4500;
/** Cap how long we'll wait on a connect handshake before giving up quietly. */
const CONNECT_TIMEOUT_MS = 5000;

let client: Client | null = null;
let connected = false;
let connecting: Promise<boolean> | null = null;

let pendingContext: PresenceContext | null = null;
let lastSentAt = 0;
let flushTimer: NodeJS.Timeout | null = null;

function log(message: string, err?: unknown): void {
    if (err) console.warn(`[DiscordRPC] ${message}`, err instanceof Error ? err.message : err);
    else console.log(`[DiscordRPC] ${message}`);
}

function buildActivity(ctx: PresenceContext): SetActivity {
    const surface = SURFACE_PRESENCE[ctx.surface] ?? FALLBACK_PRESENCE;
    const activity: SetActivity = {
        details: surface.details,
        startTimestamp: SESSION_START,
        largeImageKey: LARGE_IMAGE_KEY,
        largeImageText: 'Grimoire',
        buttons: BUTTONS,
        instance: false,
    };
    if (surface.state) {
        activity.state = surface.state.replace('{count}', String(ctx.count ?? 0));
    }
    // Viewing a specific hero in the Locker: show that hero's icon as the large
    // image (Discord fetches it from the public wiki) and demote the logo to the
    // small badge.
    if (ctx.hero) {
        activity.details = 'In the Hero Locker';
        activity.state = `Customizing ${ctx.hero}`;
        activity.largeImageUrl = heroIconUrl(ctx.hero);
        activity.largeImageText = ctx.hero;
        activity.smallImageKey = LARGE_IMAGE_KEY;
        activity.smallImageText = 'Grimoire';
    }
    return activity;
}

/**
 * Connect to the local Discord client if it isn't already. Resolves false (and
 * stays quiet) when Discord isn't running or the handshake fails. Coalesces
 * concurrent callers onto a single in-flight attempt.
 */
async function ensureConnected(): Promise<boolean> {
    if (connected && client) return true;
    if (connecting) return connecting;

    connecting = (async () => {
        try {
            const c = new Client({ clientId: DISCORD_CLIENT_ID });
            c.on('disconnected', () => {
                // Drop the dead client so the next ensureConnected() builds a
                // fresh one instead of reusing a closed socket. Guarded in case
                // a reconnect already replaced our reference.
                connected = false;
                if (client === c) client = null;
            });
            await withTimeout(c.login(), CONNECT_TIMEOUT_MS);
            client = c;
            connected = true;
            log('connected to local Discord client');
            return true;
        } catch (err) {
            log('connect failed (is Discord running?)', err);
            try {
                await client?.destroy();
            } catch {
                /* ignore */
            }
            client = null;
            connected = false;
            return false;
        } finally {
            connecting = null;
        }
    })();

    return connecting;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect timed out')), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/** Send the latest pending context, connecting first if needed. */
async function flush(): Promise<void> {
    flushTimer = null;
    const ctx = pendingContext;
    if (!ctx) return;
    pendingContext = null;
    lastSentAt = Date.now();

    if (!(await ensureConnected())) return;
    try {
        await client?.user?.setActivity(buildActivity(ctx));
    } catch (err) {
        log('setActivity failed', err);
    }
}

/** Throttle: send now if we're past the interval, else schedule a trailing send. */
function scheduleFlush(): void {
    if (flushTimer) return;
    const elapsed = Date.now() - lastSentAt;
    if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
        void flush();
    } else {
        flushTimer = setTimeout(() => void flush(), MIN_UPDATE_INTERVAL_MS - elapsed);
    }
}

/**
 * Update the presence for the current surface. No-op when the feature is
 * dormant (no client id configured). Called from the renderer via IPC.
 */
export function updatePresence(ctx: PresenceContext): void {
    if (!DISCORD_CLIENT_ID) return;
    pendingContext = ctx;
    scheduleFlush();
}

/**
 * Clear presence and disconnect. Called when the user turns the toggle off, so
 * their Discord profile drops the Grimoire activity promptly.
 */
export async function clearPresence(): Promise<void> {
    pendingContext = null;
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (!client) return;
    try {
        await client.user?.clearActivity();
    } catch {
        /* ignore */
    }
    try {
        await client.destroy();
    } catch {
        /* ignore */
    }
    client = null;
    connected = false;
}

/** Tear down on app quit so the IPC socket closes cleanly. */
export function destroyDiscordRpc(): void {
    void clearPresence();
}
