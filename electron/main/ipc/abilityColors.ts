import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import {
    applyHeroColor,
    applyHeroPrism,
    revertHeroColor,
    getActiveHeroColor,
    getHeroColorSupport,
    previewHeroColor,
} from '../services/heroColors';
import { saveLockerToActiveProfile } from '../services/profileLocker';
import type {
    ActiveHeroColor,
    ApplyHeroColorResult,
    ApplyHeroPrismResult,
} from '../../../src/types/mod';

/** Active Deadlock install path (dev override wins, same as ipc/abilitySounds.ts). */
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
        const result = await applyHeroColor(deadlockPath, heroName, hue, saturation, brightness);
        saveLockerToActiveProfile();
        return result;
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
        const result = await applyHeroPrism(
            deadlockPath,
            heroName,
            hue,
            saturation,
            brightness,
            animated,
            gradient,
        );
        saveLockerToActiveProfile();
        return result;
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
        const result = await revertHeroColor(deadlockPath, heroName);
        saveLockerToActiveProfile();
        return result;
    },
);

ipcMain.handle(
    'get-active-hero-color',
    (_, heroName: string): ActiveHeroColor | null => getActiveHeroColor(heroName),
);
