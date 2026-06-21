import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import { getHeroPortraits } from '../services/heroPortraits';
import { applyHeroCard, revertHeroCard, getActiveHeroCard } from '../services/heroCards';
import {
    getCustomCardSlots,
    applyCustomHeroCard,
    exportCustomHeroCard,
    getAppliedCustomCard,
    type CustomCardVariantUpload,
} from '../services/customHeroCards';
import type { CustomCardSlot } from '../../../src/types/portrait';
import {
    getSoulModelInfo,
    exportSoulModel,
    type SoulModelInfo,
} from '../services/soulContainerModels';
import {
    getHeroPoseInfo,
    exportHeroPose,
    getRiggedHeroPose,
    exportRiggedHeroPose,
    type HeroPoseInfo,
    type HeroPoseSkinSource,
} from '../services/heroPoseModels';
import type { HeroPortrait } from '../../../src/types/portrait';
import type { ApplyHeroCardResult } from '../../../src/types/mod';

/** Active Deadlock install path (dev override wins, same as ipc/mods.ts). */
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
    'get-custom-card-slots',
    async (_, heroName: string): Promise<CustomCardSlot[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return [];
        return getCustomCardSlots(deadlockPath, heroName);
    }
);

ipcMain.handle(
    'apply-custom-hero-card',
    async (_, heroName: string, uploads: CustomCardVariantUpload[]): Promise<ApplyHeroCardResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return applyCustomHeroCard(deadlockPath, heroName, uploads);
    }
);

ipcMain.handle(
    'export-custom-hero-card',
    async (
        _,
        heroName: string,
        uploads: CustomCardVariantUpload[],
        destPath: string
    ): Promise<string> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportCustomHeroCard(deadlockPath, heroName, uploads, destPath);
    }
);

ipcMain.handle(
    'get-applied-custom-card',
    async (_, heroName: string): Promise<{ variant: string; dataUrl: string }[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return [];
        return getAppliedCustomCard(deadlockPath, heroName);
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
    async (_, metaKey: string, cacheKey: string, entry?: string): Promise<SoulModelInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportSoulModel(deadlockPath, metaKey, cacheKey, entry);
    }
);

ipcMain.handle(
    'get-hero-pose-info',
    async (_, heroName: string, skinSources?: HeroPoseSkinSource[]): Promise<HeroPoseInfo> => {
        return getHeroPoseInfo(heroName, skinSources);
    }
);

ipcMain.handle(
    'export-hero-pose',
    async (
        _,
        heroName: string,
        skinSources?: HeroPoseSkinSource[],
        fallbackSkinMetaKey?: string
    ): Promise<HeroPoseInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportHeroPose(deadlockPath, heroName, skinSources, fallbackSkinMetaKey);
    }
);

ipcMain.handle(
    'get-rigged-hero-pose',
    async (_, heroName: string, skinSources?: HeroPoseSkinSource[]): Promise<HeroPoseInfo> => {
        return getRiggedHeroPose(heroName, skinSources);
    }
);

ipcMain.handle(
    'export-rigged-hero-pose',
    async (
        _,
        heroName: string,
        skinSources?: HeroPoseSkinSource[],
        fallbackSkinMetaKey?: string
    ): Promise<HeroPoseInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportRiggedHeroPose(deadlockPath, heroName, skinSources, fallbackSkinMetaKey);
    }
);
