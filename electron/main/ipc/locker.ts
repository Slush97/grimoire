import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import { listAppliedCards, clearAllHeroCards, getAppliedCardThumbnails } from '../services/heroCards';
import { listAppliedSounds, clearAllHeroSounds } from '../services/heroSounds';
import type { LockerCardThumbnail, LockerClearScope, LockerOverview } from '../../../src/types/mod';

/** Active Deadlock install path (dev override wins, same as the other locker IPC). */
function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

// Cross-cutting Locker IPC: a summary of everything the Locker is currently
// overriding (cards + ability sounds), plus a bulk clear. Drives the
// Installed-tab "Locker Overrides" popup (toolbar Wand2 icon).
ipcMain.handle('get-locker-overview', async (): Promise<LockerOverview> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) return { cards: [], sounds: [] };
    const [cards, sounds] = await Promise.all([
        listAppliedCards(deadlockPath),
        listAppliedSounds(deadlockPath),
    ]);
    return { cards, sounds };
});

// Lazy companion to the overview: decode the real applied card art into one
// thumbnail per hero. Heavier (shells out to vpkmerge), so the popup fetches it
// separately and only when it opens, keeping the overview/count cheap.
ipcMain.handle('get-locker-card-thumbnails', async (): Promise<LockerCardThumbnail[]> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) return [];
    return getAppliedCardThumbnails(deadlockPath);
});

ipcMain.handle(
    'clear-locker-overrides',
    async (_, scope: LockerClearScope): Promise<void> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        if (scope === 'cards' || scope === 'all') await clearAllHeroCards(deadlockPath);
        if (scope === 'sounds' || scope === 'all') await clearAllHeroSounds(deadlockPath);
    },
);
