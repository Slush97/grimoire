import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import { getHeroPortraits } from '../services/heroPortraits';
import { applyHeroCard, revertHeroCard, getActiveHeroCard } from '../services/heroCards';
import {
    getSoulModelInfo,
    exportSoulModel,
    clearSoulModel,
    type SoulModelInfo,
} from '../services/soulContainerModels';
import {
    getHeroPoseInfo,
    exportHeroPose,
    type HeroPoseInfo,
} from '../services/heroPoseModels';
import type { HeroPortrait } from '../../../src/types/portrait';
import type { ApplyHeroCardResult } from '../../../src/types/mod';

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

ipcMain.handle(
    'apply-hero-card',
    async (_, heroName: string, sourceFileName: string): Promise<ApplyHeroCardResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return applyHeroCard(deadlockPath, heroName, sourceFileName);
    }
);

ipcMain.handle(
    'revert-hero-card',
    async (_, heroName: string): Promise<ApplyHeroCardResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return revertHeroCard(deadlockPath, heroName);
    }
);

ipcMain.handle(
    'get-active-hero-card',
    async (_, heroName: string): Promise<{ sourceFileName: string; variants: string[] } | null> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return null;
        return getActiveHeroCard(deadlockPath, heroName);
    }
);

ipcMain.handle(
    'get-soul-model-info',
    async (_, key: string): Promise<SoulModelInfo> => {
        return getSoulModelInfo(key);
    }
);

ipcMain.handle(
    'export-soul-model',
    async (_, metaKey: string): Promise<SoulModelInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportSoulModel(deadlockPath, metaKey);
    }
);

ipcMain.handle(
    'clear-soul-model',
    async (_, key: string): Promise<void> => {
        return clearSoulModel(key);
    }
);

ipcMain.handle(
    'get-hero-pose-info',
    async (_, heroName: string, skinMetaKey?: string): Promise<HeroPoseInfo> => {
        return getHeroPoseInfo(heroName, skinMetaKey);
    }
);

ipcMain.handle(
    'export-hero-pose',
    async (_, heroName: string, skinMetaKey?: string): Promise<HeroPoseInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportHeroPose(deadlockPath, heroName, skinMetaKey);
    }
);
