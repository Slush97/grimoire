import { app, BrowserWindow, shell, session } from 'electron';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import {
    GRIMOIRE_PROTOCOL,
    findGrimoireUrlInArgv,
    handleOneClickInstall,
    parseGrimoireUrl,
} from './services/oneClickInstall';

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
import './ipc/modDatabase';
import './ipc/crosshairPresets';
import './ipc/stats';
import './ipc/updater';
import './ipc/launch';

import { initUpdater, checkForUpdates, getInstallSource } from './services/updater';
import { runStartupRecovery } from './ipc/launch';

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
            const parsed = parseGrimoireUrl(url);
            if (parsed) {
                void handleOneClickInstall(parsed, mainWindow);
            }
        }
    });

    app.whenReady().then(() => {
        // Set app user model id for windows
        electronApp.setAppUserModelId('com.grimoire.modmanager');

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
                            "connect-src 'self' https://gamebanana.com https://*.gamebanana.com https://api.deadlock-api.com"
                        ]
                    }
                });
            });
        }

        createWindow();

        // If we were launched via a `grimoire:` URL, dispatch it once the
        // renderer is ready so the UI can navigate + show a toast before the
        // download begins. webContents.once handles both cold-launch and
        // hot-reload paths cleanly.
        if (initialProtocolUrl && mainWindow) {
            const parsedInitial = parseGrimoireUrl(initialProtocolUrl);
            if (parsedInitial) {
                mainWindow.webContents.once('did-finish-load', () => {
                    void handleOneClickInstall(parsedInitial, mainWindow);
                });
            }
        }

        // Recover from any half-finished vanilla launch (app was closed mid-session,
        // or grimoire crashed while the user was playing vanilla). Runs in background.
        void runStartupRecovery();

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
