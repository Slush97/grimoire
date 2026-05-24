import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import { getHeroPortraits } from '../services/heroPortraits';
import type { HeroPortrait } from '../../../src/types/portrait';

/** Active Deadlock install path (dev override wins, same as ipc/mods.ts). */
function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

ipcMain.handle(
    'get-hero-portraits',
    async (_, heroName: string): Promise<HeroPortrait[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return [];
        return getHeroPortraits(deadlockPath, heroName);
    }
);
