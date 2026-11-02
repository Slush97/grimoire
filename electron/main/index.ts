import { app, BrowserWindow, shell, session, protocol, nativeTheme, screen } from 'electron';
import { cleanupExpiredModBackups } from './services/modBackups';
import { windowBackgroundColor } from '../../src/lib/oledMode';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'net';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { SOUL_MODEL_SCHEME, registerSoulModelProtocol } from './services/soulContainerModels';
import { HERO_POSE_SCHEME, registerHeroPoseProtocol, sweepHeroPoseCache } from './services/heroPoseModels';
import { FOUNDRY_THUMB_SCHEME, registerFoundryThumbnailProtocol } from './services/foundryCatalog';

// The `grimoire-soul:` and `grimoire-hero:` schemes serve GLBs (soul-container
// models and posed hero stills) out of the user's library to the renderer's 3D
// viewers. Must be declared privileged before app-ready so fetch/streaming work
// under the renderer's file:// origin.
protocol.registerSchemesAsPrivileged([
    {
        scheme: SOUL_MODEL_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
    {
        scheme: HERO_POSE_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
    {
        // Serves Foundry's cached texture/icon thumbnails (PNG) to the browse grid.
        scheme: FOUNDRY_THUMB_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
]);

// The app is dark-only, so pin Chromium and the OS chrome to dark regardless
// of the system theme. On Windows this stops the native frame/menus rendering
// light, and it makes prefers-color-scheme report dark in the renderer.
nativeTheme.themeSource = 'dark';

// Initialize the file logger before anything else so console.* calls in IPC
// and service modules (imported below) flow into the rolling log file from
// the very first line. The "Save diagnostic report" button in Settings hands
// the user that file to attach to bug reports.
import { initLogger } from './services/diagnostics';
initLogger();

// Start the event-loop lag monitor right after the logger so its periodic
// "[event-loop] blocked Xms" warnings land in the same rolling file. The
// monitor only logs when the loop is genuinely stalled (>=100ms in a 10s
// window), so it stays quiet on a healthy session.
import { initEventLoopMonitor } from './services/eventLoopMonitor';
initEventLoopMonitor();

import {
    GRIMOIRE_PROTOCOL,
    findGrimoireUrlInArgv,
    handleOneClickInstall,
    isForgeLaunchUrl,
    parseGrimoireUrl,
} from './services/oneClickInstall';
import {
    handleProtocolAuthCallback,
    hydrateOnBoot as hydrateSocialSession,
    isGrimoireAuthUrl,
} from './services/socialAuth';

// Stop Electron from registering with the Windows media session / hardware
// media key stack. We never use transport controls, but opting in makes Win11
// play the audio-focus chime every time an <audio> element initializes — very
// noticeable now that sound-mod cards each mount their own player.
app.commandLine.appendSwitch(
    'disable-features',
    'HardwareMediaKeyHandling,MediaSessionService'
);

// Chromium 137 dropped the automatic SwiftShader fallback, so machines without
// hardware WebGL (VMs, blocklisted GPUs) lost every 3D preview. The "unsafe" is
// about untrusted web pages; our renderer only runs app shaders on local models.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// Node cancels every connect attempt except the one on the last address after
// this long (a few hundred ms by default), which is under the round trip from
// Australia to GameBanana's file servers. With a dead IPv6 or IPv4 address last
// in the list the connect then fails with AggregateError ETIMEDOUT even though
// the host is reachable. Applies to fetch and https alike.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

// Import IPC handlers
import './ipc/settings';
import './ipc/mods';
import './ipc/crashAdvisories';
import { startCrashAdvisories } from './services/crashAdvisories';
import './ipc/gamebanana';
import './ipc/modUpdates';
import './ipc/gamebananaFileServers';
import './ipc/system';
import './ipc/conflicts';
import './ipc/profiles';
import './ipc/snapshots';
import './ipc/modBackups';
import './ipc/modDatabase';
import './ipc/crosshairPresets';
import './ipc/cursorPacks';
import './ipc/stats';
import './ipc/updater';
import './ipc/launch';
import './ipc/social';
import './ipc/locales';
import './ipc/diagnostics';
import './ipc/portraits';
import './ipc/abilitySounds';
import './ipc/abilityColors';
import './ipc/trippyEffects';
import './ipc/locker';
import './ipc/lockerModImages';
import './ipc/appearanceImages';
import './ipc/previewCache';
import './ipc/discord';
import './ipc/saltIngest';
import './ipc/servers';
import './ipc/foundry';
import './ipc/performanceConfig';
import './ipc/forge';
import './ipc/modInterchange';

import { initUpdater, checkForUpdates, getInstallSource } from './services/updater';
import { runStartupRecovery } from './ipc/launch';
import './ipc/modSafety';
import { loadSettings, saveSettings } from './services/settings';
import {
    configureForgeBridge,
    requestForgeEnable,
    startForgeBridge,
    stopForgeBridge,
    type ForgeInstallRequest,
} from './services/forgeBridge';
import { installForgeVpk } from './services/download';
import { healModFolders, runExclusiveModMutation } from './services/mods';
import { backfillMissingMetadataHashes, recoverPrunedIdentities } from './services/metadata';
import { backfillImprintedFlags } from './services/imprintMods';
import { destroyDiscordRpc } from './services/discordRpc';
import { startSaltIngest } from './services/saltIngest';
import {
    MIN_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
    centerInWorkArea,
    isTitleBarReachable,
    resolveInitialBounds,
} from './services/windowBounds';

let mainWindow: BrowserWindow | null = null;

/** Schemes we'll hand to shell.openExternal. Restricted to web/email links
 *  so a mod description (or any other untrusted content rendered in the
 *  renderer) can't smuggle in file://, custom protocol handlers, or UNC
 *  paths that would otherwise be opened by the user's default OS handler. */
const SAFE_OPEN_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function openExternalSafe(rawUrl: string): void {
    try {
        const u = new URL(rawUrl);
        if (SAFE_OPEN_SCHEMES.has(u.protocol)) {
            void shell.openExternal(rawUrl);
            return;
        }
        console.warn('[Main] blocked openExternal for scheme:', u.protocol);
    } catch {
        console.warn('[Main] blocked openExternal for malformed URL');
    }
}

function getConfiguredDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

/**
 * Install a VPK handed over by deadlockforge.net through the local bridge.
 *
 * By the time this runs the bridge has verified the payload is a real VPK
 * inside the size envelope, and the user has confirmed the dialog. All that is
 * left is to route it into the normal install pipeline.
 */
async function handleForgeInstall(request: ForgeInstallRequest): Promise<void> {
    const deadlockPath = getConfiguredDeadlockPath();
    if (!deadlockPath) {
        // The confirmation dialog already refuses to offer Install without a
        // configured game folder, so reaching here means the renderer's copy of
        // settings was stale. Nothing to install into: log and drop.
        console.warn('[forgeInstall] No Deadlock path configured, ignoring install request');
        return;
    }

    await installForgeVpk(
        deadlockPath,
        {
            sourcePath: request.tempPath,
            name: request.name,
            author: request.author,
            type: request.type,
            origin: request.origin,
        },
        mainWindow
    );
}

async function runStartupMetadataMaintenance(): Promise<void> {
    const deadlockPath = getConfiguredDeadlockPath();
    if (!deadlockPath) return;
    const devMode = loadSettings().devMode;
    const stillActive = () => getConfiguredDeadlockPath() === deadlockPath && loadSettings().devMode === devMode;

    try {
        await runExclusiveModMutation(async () => {
            if (stillActive()) await healModFolders(deadlockPath);
        });
    } catch (error) {
        console.warn('[mods] Startup heal failed:', error);
    }
    if (!stillActive()) return;

    try {
        const updated = await backfillMissingMetadataHashes(deadlockPath, (apply) => runExclusiveModMutation(apply));
        if (updated > 0) {
            console.log(`[Metadata] Backfilled SHA-256 for ${updated} mod metadata entr${updated === 1 ? 'y' : 'ies'}`);
        }
    } catch (error) {
        console.warn('[Metadata] Startup SHA-256 backfill failed:', error);
    }
    if (!stillActive()) return;

    const recovered = recoverPrunedIdentities();
    if (recovered > 0) {
        console.log(`[Metadata] Recovered identity for ${recovered} mod${recovered === 1 ? '' : 's'} from pre-prune backups`);
    }

    try {
        // Reconcile the imprinted hint flag with the embed truth (files imprinted
        // by builds that never persisted the flag would otherwise read as
        // un-imprinted forever; see backfillImprintedFlags).
        const stamped = await backfillImprintedFlags(deadlockPath);
        if (stamped > 0) {
            console.log(`[Metadata] Backfilled imprinted flag for ${stamped} mod${stamped === 1 ? '' : 's'}`);
        }
    } catch (error) {
        console.warn('[Metadata] Startup imprint-flag backfill failed:', error);
    }
}

function createWindow(): void {
    const settings = loadSettings();
    const displays = screen.getAllDisplays();
    const initial = resolveInitialBounds(settings.windowBounds, displays.map((d) => d.workArea));
    // One line per launch so a "window is invisible" report can be read off the
    // log: what was saved, what we did with it, and what Windows says is there.
    console.log('[Window] startup bounds:', JSON.stringify({
        saved: settings.windowBounds ?? null,
        position: settings.windowBounds ? (initial.x !== undefined ? 'honoured' : 'dropped') : 'none saved',
        initial,
        displays: displays.map((d) => ({
            id: d.id,
            bounds: d.bounds,
            workArea: d.workArea,
            scaleFactor: d.scaleFactor,
        })),
    }));
    mainWindow = new BrowserWindow({
        width: initial.width,
        height: initial.height,
        ...(initial.x !== undefined && initial.y !== undefined
            ? { x: initial.x, y: initial.y }
            : {}),
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        title: 'Grimoire',
        show: false, // Don't show until ready to prevent white flash
        backgroundColor: windowBackgroundColor(settings.oledMode),
        // Standard native frame on every platform. themeSource is forced to
        // 'dark' above, so Windows draws its title bar dark; the previous
        // hidden-titleBar + overlay approach put the OS window controls on
        // top of the renderer, where they collided with in-app controls and
        // page-level overlays.
        webPreferences: {
            preload: join(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Lets the renderer apply the OLED theme before its first paint,
            // instead of waiting on the async settings IPC (which flashed the
            // default grey canvas). Read in the preload via process.argv.
            additionalArguments: settings.oledMode ? ['--grimoire-oled'] : [],
        },
    });

    // Auto-hiding still lets Alt open the native menu instead of a mod preview.
    if (process.platform !== 'darwin') mainWindow.removeMenu();

    // Show window when ready to prevent white screen flash. If the renderer
    // never paints, show it anyway after a few seconds: a visible broken
    // window beats an invisible process the user can only kill.
    let revealed = false;
    const reveal = () => {
        if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
        revealed = true;
        if (initial.isMaximized) mainWindow.maximize();
        mainWindow.show();
    };
    const revealFallback = setTimeout(() => {
        if (revealed) return;
        console.warn('[Window] ready-to-show did not fire within 5s, showing the window anyway');
        reveal();
    }, 5000);
    mainWindow.once('ready-to-show', () => {
        clearTimeout(revealFallback);
        reveal();
    });
    mainWindow.once('closed', () => clearTimeout(revealFallback));

    mainWindow.webContents.on('unresponsive', () => {
        console.warn('[Window] renderer became unresponsive');
    });
    mainWindow.webContents.on('responsive', () => {
        console.log('[Window] renderer is responsive again');
    });

    // Persist position and size so the app reopens where the user left it.
    // We record the *normal* (non-maximized) bounds via getNormalBounds so a
    // maximized session still restores to a sensible windowed rectangle, plus
    // the maximized flag itself. Debounced because move/resize fire rapidly
    // during a drag.
    let saveBoundsTimer: NodeJS.Timeout | null = null;
    const writeBounds = () => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
        try {
            const bounds = mainWindow.getNormalBounds();
            saveSettings({
                ...loadSettings(),
                windowBounds: {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    isMaximized: mainWindow.isMaximized(),
                },
            });
        } catch (err) {
            console.warn('[Main] Failed to persist window bounds:', err);
        }
    };
    const persistBounds = () => {
        if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
        saveBoundsTimer = setTimeout(() => {
            saveBoundsTimer = null;
            writeBounds();
        }, 400);
    };
    mainWindow.on('resize', persistBounds);
    mainWindow.on('move', persistBounds);
    mainWindow.on('maximize', persistBounds);
    mainWindow.on('unmaximize', persistBounds);
    // Flush the final rectangle synchronously: a move/resize immediately before
    // quitting would otherwise be swallowed by the debounce.
    mainWindow.on('close', () => {
        if (saveBoundsTimer) {
            clearTimeout(saveBoundsTimer);
            saveBoundsTimer = null;
        }
        writeBounds();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        openExternalSafe(details.url);
        return { action: 'deny' };
    });

    // Catch in-place navigations (bare `<a href="https://...">` clicks in
    // user content like mod descriptions and comments). Without this, those
    // links replace the React app with a webpage and the user has no back
    // button to recover. setWindowOpenHandler only covers target="_blank".
    // We restrict the allowlist to the renderer's own directory (the dev
    // server origin or the packaged renderer folder); anything else,
    // including any other file:// URL a malicious mod description might
    // smuggle in, ships out to the user's default browser via
    // shell.openExternal. HashRouter routes change the URL fragment via
    // history.pushState and don't trigger will-navigate, so the renderer's
    // own SPA navigation is unaffected by this filter.
    const rendererSourceUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
        ? process.env['ELECTRON_RENDERER_URL']
        : pathToFileURL(join(__dirname, '../renderer/index.html')).href;
    const rendererBase = (() => {
        const parsed = new URL(rendererSourceUrl);
        parsed.search = '';
        parsed.hash = '';
        parsed.pathname = parsed.pathname.replace(/[^/]*$/, '');
        return parsed.href;
    })();
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(rendererBase)) return;
        event.preventDefault();
        openExternalSafe(url);
    });

    // Debug: log renderer errors
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('[Main] Renderer failed to load:', errorCode, errorDescription);
    });

    // --- UI zoom (Ctrl +/-/0), persisted across launches. The renderer is dense
    // and on hi-DPI laptops everything renders tiny, so let the user scale the
    // whole UI. Driven through webContents.setZoomFactor via before-input-event
    // (Windows/Linux windows have no native View > Zoom menu).
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 3.0;
    const ZOOM_STEP = 0.1;
    const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));
    const persistZoom = (z: number) => {
        try {
            saveSettings({ ...loadSettings(), zoomFactor: z });
        } catch (err) {
            console.warn('[Main] Failed to persist zoom factor:', err);
        }
    };
    // Zoom factor resets to 1 on every load, so re-apply the saved value each time.
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.setZoomFactor(clampZoom(loadSettings().zoomFactor ?? 1));
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !input.control || input.alt || input.meta || !mainWindow) return;
        const wc = mainWindow.webContents;
        let next: number | null = null;
        if (input.key === '=' || input.key === '+' || input.key === 'Add') next = clampZoom(wc.getZoomFactor() + ZOOM_STEP);
        else if (input.key === '-' || input.key === 'Subtract') next = clampZoom(wc.getZoomFactor() - ZOOM_STEP);
        else if (input.key === '0') next = 1;
        if (next === null) return;
        event.preventDefault();
        wc.setZoomFactor(next);
        persistZoom(next);
    });

    // Load the renderer
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
        const rendererPath = join(__dirname, '../renderer/index.html');
        console.log('[Main] Loading renderer from:', rendererPath);
        mainWindow.loadFile(rendererPath);
    }

    // Open DevTools in development only
    if (is.dev) {
        mainWindow.webContents.openDevTools();
    }
}

/**
 * Move the window onto the display under the cursor when it is on another
 * display or its title bar is out of reach there. The user just clicked a
 * shortcut, so they can see that display; the one the window is on may be a
 * switched-off TV, a dummy plug or a virtual display that startup can't tell
 * apart from a real monitor. The move/resize listeners persist the new bounds.
 */
function bringWindowToCursorDisplay(win: BrowserWindow): void {
    if (!win.isVisible()) win.show();

    const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const current = win.getBounds();
    const onTarget = screen.getDisplayMatching(current).id === target.id;
    if (onTarget && isTitleBarReachable(current, [target.workArea])) return;

    const wasMaximized = win.isMaximized();
    if (wasMaximized) win.unmaximize();
    const next = centerInWorkArea(win.getNormalBounds(), target.workArea);
    console.log('[Window] relaunch moved the window to display', target.id, JSON.stringify({ from: current, to: next }));
    win.setBounds(next);
    if (wasMaximized) win.maximize();
}

// Register the `grimoire:` URL scheme so Windows hands `grimoire:...` URLs to
// this app. The packaged NSIS installer also writes registry entries via the
// `protocols:` block in electron-builder.yml, but the runtime call covers
// dev/portable launches and re-asserts ownership when needed.
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(GRIMOIRE_PROTOCOL, process.execPath, [
            resolve(process.argv[1]),
        ]);
    }
} else {
    app.setAsDefaultProtocolClient(GRIMOIRE_PROTOCOL);
}

// Capture any `grimoire:` URL from the launch args. We dispatch it after the
// renderer has loaded so the UI can show the toast before extraction starts.
const initialProtocolUrl = findGrimoireUrlInArgv(process.argv);

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        const url = findGrimoireUrlInArgv(argv);

        // Focus the main window if a second instance is attempted. A plain
        // relaunch is what a user does when they can't see the window, so that
        // also pulls it onto the display they launched from. Protocol URLs come
        // from the browser and must not move it.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!url) bringWindowToCursorDisplay(mainWindow);
            mainWindow.focus();
        }

        if (url) {
            if (isGrimoireAuthUrl(url)) {
                void handleProtocolAuthCallback(url);
            } else if (isForgeLaunchUrl(url)) {
                // DeadlockForge could not find the bridge and asked us to start.
                // Being open was the point; offer to switch the bridge on.
                requestForgeEnable();
            } else {
                const parsed = parseGrimoireUrl(url);
                if (parsed) {
                    void handleOneClickInstall(parsed, mainWindow);
                }
            }
        }
    });

    // Local log only: makes a renderer or GPU crash visible in the next report.
    app.on('render-process-gone', (_event, _webContents, details) => {
        console.error('[Main] render process gone:', details.reason, 'exitCode', details.exitCode);
    });
    app.on('child-process-gone', (_event, details) => {
        console.error('[Main] child process gone:', details.type, details.name ?? '', details.reason, 'exitCode', details.exitCode);
    });

    app.whenReady().then(() => {
        // Set app user model id for windows
        electronApp.setAppUserModelId('com.grimoire.modmanager');

        // On Windows and Linux, Chromium downloads Hunspell dictionaries from
        // Google's CDN. Only an empty language list stops it: on Electron 35,
        // setSpellCheckerEnabled(false) and webPreferences.spellcheck=false
        // both still download. A no-op on macOS, which uses the OS checker.
        session.defaultSession.setSpellCheckerLanguages([]);

        // Serve per-mod soul-container GLBs from the user's library.
        registerSoulModelProtocol();

        // Serve per-hero posed stills from the user's library.
        registerHeroPoseProtocol();

        // Serve Foundry's cached texture/icon thumbnails to the browse grid.
        registerFoundryThumbnailProtocol();

        // Reclaim disk from stale or least-recently-used pose entries; the
        // cache is also swept after each export.
        void sweepHeroPoseCache();

        // Default open or close DevTools by F12 in development
        app.on('browser-window-created', (_, window) => {
            optimizer.watchWindowShortcuts(window);
        });

        // Set Content Security Policy (production only - Vite needs inline scripts for HMR in dev)
        if (!is.dev) {
            session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
                callback({
                    responseHeaders: {
                        ...details.responseHeaders,
                        'Content-Security-Policy': [
                            "default-src 'self'; " +
                            "script-src 'self'; " +
                            "style-src 'self' 'unsafe-inline'; " +
                            "font-src 'self'; " +
                            // `grimoire-foundry:` serves Foundry's cached texture
                            // thumbnails, rendered as <img>, so they must be allowed
                            // here or the browse grid is blank under the prod CSP.
                            "img-src 'self' data: https: blob: grimoire-foundry: grimoire-hero:; " +
                            // Foundry voice-line auditions are served as `data:audio/mpeg`
                            // URLs into an <audio> element (the clip MP3 is sliced out of
                            // the `.vsnd_c` in the main process), so `data:` must be allowed
                            // here or audition is blocked under the prod CSP (works in dev,
                            // which has no CSP).
                            "media-src 'self' https: data:; " +
                            // Social fetches happen from the main process (fetch in Node),
                            // not the renderer, so they bypass CSP. The `https://*.workers.dev`
                            // entry is here so any future renderer-side asset (e.g. avatar URL
                            // not on Steam's CDN) doesn't trip CSP unexpectedly. Update when a
                            // dedicated grimoire-social production domain is locked.
                            //
                            // The `grimoire-soul:`/`grimoire-hero:` schemes serve the
                            // Locker's 3D GLBs; GLTFLoader fetches them, so they must be
                            // allowed here or the load is blocked under the prod CSP (dev
                            // has no CSP, which is why the 3D previews work in `pnpm dev`
                            // but not in a packaged build). `blob:` is required too:
                            // three's GLTFLoader extracts each embedded GLB texture into a
                            // blob: URL and loads it via ImageBitmapLoader, which fetch()es
                            // it; without blob: here the textures fail and models render
                            // untextured (white).
                            "connect-src 'self' blob: data: grimoire-soul: grimoire-hero: https://gamebanana.com https://*.gamebanana.com https://api.deadlock-api.com https://*.workers.dev"
                        ]
                    }
                });
            });
        }

        createWindow();
        startCrashAdvisories();
        void cleanupExpiredModBackups().catch((error) => console.warn('[ModBackups] Startup cleanup failed:', error));

        // Start the DeadlockForge local install bridge. No-op unless the user
        // has switched it on in Settings, so the listening socket does not
        // exist for anyone who never uses DeadlockForge.
        configureForgeBridge(handleForgeInstall, getMainWindow);
        void startForgeBridge();

        // If we were launched via a `grimoire:` URL, dispatch it once the
        // renderer is ready so the UI can navigate + show a toast before the
        // download begins. webContents.once handles both cold-launch and
        // hot-reload paths cleanly. Auth callbacks take precedence over the
        // one-click installer dispatch.
        if (initialProtocolUrl && mainWindow) {
            if (isGrimoireAuthUrl(initialProtocolUrl)) {
                void handleProtocolAuthCallback(initialProtocolUrl);
            } else if (isForgeLaunchUrl(initialProtocolUrl)) {
                // Cold launch from the site's "start Grimoire" URL. Wait for the
                // renderer so the prompt has somewhere to appear.
                mainWindow.webContents.once('did-finish-load', () => {
                    requestForgeEnable();
                });
            } else {
                const parsedInitial = parseGrimoireUrl(initialProtocolUrl);
                if (parsedInitial) {
                    mainWindow.webContents.once('did-finish-load', () => {
                        void handleOneClickInstall(parsedInitial, mainWindow);
                    });
                }
            }
        }

        // Restore a previously-persisted social session (no-op if none, or if
        // we're on Linux without a real secret store: ADR-011). Its check
        // calls the Social server, so it waits until Social is turned on.
        if (loadSettings().experimentalSocial) void hydrateSocialSession();

        // Resume the opt-in match-salt contributor across restarts.
        if (loadSettings().contributeMatchSalts) {
            startSaltIngest();
        }

        // Recover from any half-finished vanilla launch (app was closed mid-session,
        // or grimoire crashed while the user was playing vanilla), then fill in
        // SHA-256 metadata for older entries that were written before hashing.
        void runStartupRecovery().finally(() => {
            void runStartupMetadataMaintenance();
        });

        // Initialize auto-updater (production only). Skip the background check
        // for apt/AUR/snap installs since the package manager owns updates, and
        // on a fresh install, where the renderer checks once the welcome screen
        // (which offers the off switch) is done.
        if (!is.dev && mainWindow) {
            initUpdater(mainWindow);
            const settings = loadSettings();
            if (getInstallSource() !== 'managed' && settings.autoCheckAppUpdates && settings.hasCompletedSetup) {
                setTimeout(() => {
                    checkForUpdates().catch((err) => {
                        console.log('[Updater] Auto-check failed:', err.message);
                    });
                }, 5000);
            }
        }

        app.on('activate', () => {
            // On macOS re-create window when dock icon is clicked
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    // Close the Discord RPC IPC socket cleanly so the activity drops off the
    // user's profile the moment Grimoire quits (no-op if RPC was never enabled).
    app.on('before-quit', () => {
        destroyDiscordRpc();
        void stopForgeBridge();
    });
}

// Export mainWindow for IPC handlers that need to send events
export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}
