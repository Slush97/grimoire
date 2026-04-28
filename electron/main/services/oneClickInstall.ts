import { BrowserWindow } from 'electron';
import { downloadModFromUrl } from './download';
import { loadSettings } from './settings';
import { validateDownloadUrl } from './security';

export const GRIMOIRE_PROTOCOL = 'grimoire';

export interface ParsedGrimoireUrl {
    archiveUrl: string;
    modType?: string;
    modId?: number;
}

/**
 * Pull a `grimoire:` URL out of process argv (Windows passes the URL as a
 * regular argv element on launch / second-instance). Returns null when no
 * protocol URL is present.
 */
export function findGrimoireUrlInArgv(argv: string[]): string | null {
    for (const arg of argv) {
        if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${GRIMOIRE_PROTOCOL}:`)) {
            return arg;
        }
    }
    return null;
}

/**
 * Parse a `grimoire:[url],[modType],[modId]` URL per the GameBanana 1-Click
 * spec. Returns null if the URL is malformed or the archive URL fails the
 * trusted-domain check.
 */
export function parseGrimoireUrl(url: string): ParsedGrimoireUrl | null {
    if (!url.toLowerCase().startsWith(`${GRIMOIRE_PROTOCOL}:`)) return null;
    const payload = url.slice(GRIMOIRE_PROTOCOL.length + 1).trim();
    if (!payload) return null;

    const parts = payload.split(',');
    const archiveUrl = parts[0];
    const modType = parts[1]?.trim() || undefined;
    const modIdRaw = parts[2]?.trim();
    const modIdParsed = modIdRaw ? parseInt(modIdRaw, 10) : undefined;
    const modId =
        typeof modIdParsed === 'number' && !Number.isNaN(modIdParsed) ? modIdParsed : undefined;

    try {
        validateDownloadUrl(archiveUrl);
    } catch (err) {
        console.warn('[oneClick] Rejected URL from protocol handler:', err);
        return null;
    }

    return { archiveUrl, modType, modId };
}

/**
 * Queue a 1-Click install. Notifies the renderer first so the UI can route
 * to the Installed page and surface a toast — the existing download-progress
 * pipeline takes over from there.
 */
export async function handleOneClickInstall(
    parsed: ParsedGrimoireUrl,
    mainWindow: BrowserWindow | null
): Promise<void> {
    const settings = loadSettings();
    const deadlockPath =
        settings.devMode && settings.devDeadlockPath
            ? settings.devDeadlockPath
            : settings.deadlockPath;

    if (!deadlockPath) {
        mainWindow?.webContents.send('one-click-install', {
            archiveUrl: parsed.archiveUrl,
            modId: parsed.modId,
            modType: parsed.modType,
            error: 'Set your Deadlock install path in Settings before using 1-Click installs.',
        });
        return;
    }

    mainWindow?.webContents.send('one-click-install', {
        archiveUrl: parsed.archiveUrl,
        modId: parsed.modId,
        modType: parsed.modType,
    });

    try {
        await downloadModFromUrl(
            deadlockPath,
            {
                archiveUrl: parsed.archiveUrl,
                modId: parsed.modId,
                modType: parsed.modType,
            },
            mainWindow
        );
    } catch (err) {
        console.error('[oneClick] Install failed:', err);
    }
}
