import { app, BrowserWindow, shell, session } from 'electron';
import { join, resolve } from 'path';
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

import { initUpdater, checkForUpdates } from './services/updater';
import { runStartupRecovery } from './ipc/launch';

let mainWindow: BrowserWindow | null = null;

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
            sandbox: false,
        },
    });

    // Show window when ready to prevent white screen flash
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: 'deny' };
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

        // Initialize auto-updater (production only)
        if (!is.dev && mainWindow) {
            initUpdater(mainWindow);
            // Auto-check for updates after a short delay
            setTimeout(() => {
                checkForUpdates().catch((err) => {
                    console.log('[Updater] Auto-check failed:', err.message);
                });
            }, 5000);
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
