import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import {
    applyTrippySkin,
    getActiveTrippySkin,
    previewTrippySprite,
    revertTrippySkin,
} from '../services/trippyEffects';
import { applyHeroTrippyVfx } from '../services/heroColors';
import { saveLockerToActiveProfile } from '../services/profileLocker';
import type {
    ActiveTrippySkin,
    ApplyTrippySkinResult,
    ApplyTrippyVfxResult,
    TrippySpriteOptions,
    TrippySpriteResult,
    TrippyVfxChoice,
} from '../../../src/types/mod';

/** Active Deadlock install path (dev override wins, same as ipc/abilityColors.ts). */
// Trippy procedural effects (services/trippyEffects.ts + the trippy mode in
// services/heroColors.ts). The preview sprite is pure pattern generation, so it
// needs no Deadlock path: the Effects panel can show live swatches before a
// game install is even configured.
ipcMain.handle(
    'preview-trippy-sprite',
    (_, opts: TrippySpriteOptions): Promise<TrippySpriteResult> => previewTrippySprite(opts),
);

ipcMain.handle(
    'apply-trippy-skin',
    async (
        _,
        heroName: string,
        paint: Partial<ActiveTrippySkin>,
    ): Promise<ApplyTrippySkinResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        const result = await applyTrippySkin(deadlockPath, heroName, paint);
        saveLockerToActiveProfile();
        return result;
    },
);

ipcMain.handle(
    'revert-trippy-skin',
    async (_, heroName: string): Promise<ApplyTrippySkinResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        const result = await revertTrippySkin(deadlockPath, heroName);
        saveLockerToActiveProfile();
        return result;
    },
);

ipcMain.handle(
    'get-active-trippy-skin',
    (_, heroName: string): ActiveTrippySkin | null => getActiveTrippySkin(heroName),
);

ipcMain.handle(
    'apply-trippy-vfx',
    async (
        _,
        heroName: string,
        choice: Partial<TrippyVfxChoice>,
    ): Promise<ApplyTrippyVfxResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        const result = await applyHeroTrippyVfx(deadlockPath, heroName, choice);
        saveLockerToActiveProfile();
        return result;
    },
);
