import { app, BrowserWindow, shell, session } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

// Enable HiDPI support on Linux (fixes blurry rendering on Wayland/fractional scaling)
if (process.platform === 'linux') {
    // Detect if running under Wayland or X11
    const isWayland = !!process.env['WAYLAND_DISPLAY'];

    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
    app.commandLine.appendSwitch('ozone-platform', isWayland ? 'wayland' : 'x11');
}

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

import { initUpdater, checkForUpdates } from './services/updater';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 600,
        minHeight: 400,
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

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Focus the main window if a second instance is attempted
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
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
