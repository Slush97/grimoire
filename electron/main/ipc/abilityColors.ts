import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import {
    applyHeroColor,
    applyHeroPrism,
    revertHeroColor,
    getActiveHeroColor,
    getHeroColorSupport,
    previewHeroColor,
} from '../services/heroColors';
import type {
    ActiveHeroColor,
    ApplyHeroColorResult,
    ApplyHeroPrismResult,
} from '../../../src/types/mod';

/** Active Deadlock install path (dev override wins, same as ipc/abilitySounds.ts). */
function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

// Per-hero ability-COLOR recolor (services/heroColors.ts). Mirrors the
// apply/revert/get trio in ipc/abilitySounds.ts: recolor a hero's ability VFX to
// one hue, revert it, and read back the active hue. Plus a sync support check so
// the picker can gate heroes with no pinned recipe.
ipcMain.handle(
    'get-hero-color-support',
    (_, heroName: string): boolean => getHeroColorSupport(heroName),
);

ipcMain.handle(
    'apply-hero-color',
    async (
        _,
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
    ): Promise<ApplyHeroColorResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return applyHeroColor(deadlockPath, heroName, hue, saturation, brightness);
    },
);

ipcMain.handle(
    'apply-hero-prism',
    async (
        _,
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
        animated: boolean,
        gradient: string | null,
    ): Promise<ApplyHeroPrismResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return applyHeroPrism(
            deadlockPath,
            heroName,
            hue,
            saturation,
            brightness,
            animated,
            gradient,
        );
    },
);

ipcMain.handle(
    'preview-hero-color',
    async (
        _,
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
    ): Promise<string> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return previewHeroColor(deadlockPath, heroName, hue, saturation, brightness);
    },
);

ipcMain.handle(
    'revert-hero-color',
    async (_, heroName: string): Promise<ApplyHeroColorResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return revertHeroColor(deadlockPath, heroName);
    },
);

ipcMain.handle(
    'get-active-hero-color',
    (_, heroName: string): ActiveHeroColor | null => getActiveHeroColor(heroName),
);
