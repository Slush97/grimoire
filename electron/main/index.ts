import { app, BrowserWindow, shell, session, protocol } from 'electron';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { SOUL_MODEL_SCHEME, registerSoulModelProtocol } from './services/soulContainerModels';
import { HERO_POSE_SCHEME, registerHeroPoseProtocol } from './services/heroPoseModels';

// The `grimoire-soul:` and `grimoire-hero:` schemes serve GLBs (soul-container
// models and posed hero stills) out of the user's library to the renderer's 3D
// viewers. Must be declared privileged before app-ready so fetch/streaming work
// under the renderer's file:// origin.
protocol.registerSchemesAsPrivileged([
    {
        scheme: SOUL_MODEL_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
        scheme: HERO_POSE_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
]);

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

// Import IPC handlers
import './ipc/settings';
import './ipc/mods';
import './ipc/gamebanana';
import './ipc/system';
import './ipc/conflicts';
import './ipc/profiles';
import './ipc/snapshots';
import './ipc/modDatabase';
import './ipc/crosshairPresets';
import './ipc/stats';
import './ipc/updater';
import './ipc/launch';
import './ipc/social';
import './ipc/diagnostics';
import './ipc/portraits';
import './ipc/abilitySounds';
import './ipc/locker';
import './ipc/previewCache';

import { initUpdater, checkForUpdates, getInstallSource } from './services/updater';
import { runStartupRecovery } from './ipc/launch';
import { loadSettings, saveSettings } from './services/settings';
import { backfillMissingMetadataHashes } from './services/metadata';

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

async function backfillStartupMetadataHashes(): Promise<void> {
    const deadlockPath = getConfiguredDeadlockPath();
    if (!deadlockPath) return;

    try {
        const updated = await backfillMissingMetadataHashes(deadlockPath);
        if (updated > 0) {
            console.log(`[Metadata] Backfilled SHA-256 for ${updated} mod metadata entr${updated === 1 ? 'y' : 'ies'}`);
        }
    } catch (error) {
        console.warn('[Metadata] Startup SHA-256 backfill failed:', error);
    }
}

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Grimoire',
        show: false, // Don't show until ready to prevent white flash
        backgroundColor: '#1e1e2e', // Dark background matching app theme
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    // Show window when ready to prevent white screen flash
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
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
    // (the menu bar is auto-hidden, so there's no View > Zoom to lean on).
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
        // Focus the main window if a second instance is attempted
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }

        const url = findGrimoireUrlInArgv(argv);
        if (url) {
            if (isGrimoireAuthUrl(url)) {
                void handleProtocolAuthCallback(url);
            } else {
                const parsed = parseGrimoireUrl(url);
                if (parsed) {
                    void handleOneClickInstall(parsed, mainWindow);
                }
            }
        }
    });

    app.whenReady().then(() => {
        // Set app user model id for windows
        electronApp.setAppUserModelId('com.grimoire.modmanager');

        // Serve per-mod soul-container GLBs from the user's library.
        registerSoulModelProtocol();

        // Serve per-hero posed stills from the user's library.
        registerHeroPoseProtocol();

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
                            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                            "font-src 'self' https://fonts.gstatic.com; " +
                            "img-src 'self' data: https: blob:; " +
                            "media-src 'self' https:; " +
                            // Social fetches happen from the main process (fetch in Node),
                            // not the renderer, so they bypass CSP. The `https://*.workers.dev`
                            // entry is here so any future renderer-side asset (e.g. avatar URL
                            // not on Steam's CDN) doesn't trip CSP unexpectedly. Update when a
                            // dedicated grimoire-social production domain is locked.
                            "connect-src 'self' https://gamebanana.com https://*.gamebanana.com https://api.deadlock-api.com https://*.workers.dev"
                        ]
                    }
                });
            });
        }

        createWindow();

        // If we were launched via a `grimoire:` URL, dispatch it once the
        // renderer is ready so the UI can navigate + show a toast before the
        // download begins. webContents.once handles both cold-launch and
        // hot-reload paths cleanly. Auth callbacks take precedence over the
        // one-click installer dispatch.
        if (initialProtocolUrl && mainWindow) {
            if (isGrimoireAuthUrl(initialProtocolUrl)) {
                void handleProtocolAuthCallback(initialProtocolUrl);
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
        // we're on Linux without a real secret store — ADR-011).
        void hydrateSocialSession();

        // Recover from any half-finished vanilla launch (app was closed mid-session,
        // or grimoire crashed while the user was playing vanilla), then fill in
        // SHA-256 metadata for older entries that were written before hashing.
        void runStartupRecovery().finally(() => {
            void backfillStartupMetadataHashes();
        });

        // Initialize auto-updater (production only). Skip the background check
        // for apt/AUR/snap installs since the package manager owns updates.
        if (!is.dev && mainWindow) {
            initUpdater(mainWindow);
            if (getInstallSource() !== 'managed') {
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
}

// Export mainWindow for IPC handlers that need to send events
export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}
