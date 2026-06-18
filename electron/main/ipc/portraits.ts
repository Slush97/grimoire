import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import { getHeroPortraits, getHeroPanoramaBackdrop } from '../services/heroPortraits';
import {
    getHeroPoseAuthoring,
    writeHeroPoseAuthoringEntry,
} from '../services/heroPoseAuthoring';
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
    getHeroPoseClips,
    getRiggedHeroPose,
    exportRiggedHeroPose,
    type HeroPoseInfo,
    type HeroPoseClip,
    type HeroPoseSkinSource,
    type HeroPoseSelection,
} from '../services/heroPoseModels';
import type {
    HeroPortrait,
    HeroBackdrop,
    HeroPoseAuthoringEntry,
    HeroPoseAuthoringMap,
} from '../../../src/types/portrait';
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
    'get-hero-panorama-backdrop',
    async (
        _,
        heroName: string,
        skinSources?: HeroPoseSkinSource[]
    ): Promise<HeroBackdrop | null> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return null;
        return getHeroPanoramaBackdrop(deadlockPath, heroName, skinSources);
    }
);

// Per-hero pose/camera authoring for baked card snapshots. Read is available
// everywhere (the bake consults it); write is dev-only (the service throws in a
// packaged build) and regenerates the committed data module.
ipcMain.handle('get-hero-pose-authoring', (): HeroPoseAuthoringMap => {
    return getHeroPoseAuthoring();
});

ipcMain.handle(
    'write-hero-pose-authoring',
    (_, heroName: string, entry: HeroPoseAuthoringEntry): Promise<HeroPoseAuthoringMap> => {
        return writeHeroPoseAuthoringEntry(heroName, entry);
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
    async (_, metaKey: string, cacheKey: string): Promise<SoulModelInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportSoulModel(deadlockPath, metaKey, cacheKey);
    }
);

ipcMain.handle(
    'get-hero-pose-info',
    async (
        _,
        heroName: string,
        skinSources?: HeroPoseSkinSource[],
        pose?: HeroPoseSelection
    ): Promise<HeroPoseInfo> => {
        return getHeroPoseInfo(heroName, skinSources, pose);
    }
);

ipcMain.handle(
    'export-hero-pose',
    async (
        _,
        heroName: string,
        skinSources?: HeroPoseSkinSource[],
        fallbackSkinMetaKey?: string,
        pose?: HeroPoseSelection
    ): Promise<HeroPoseInfo> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return exportHeroPose(deadlockPath, heroName, skinSources, fallbackSkinMetaKey, pose);
    }
);

ipcMain.handle(
    'get-hero-pose-clips',
    async (_, heroName: string, skinSources?: HeroPoseSkinSource[]): Promise<HeroPoseClip[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) return [];
        return getHeroPoseClips(deadlockPath, heroName, skinSources);
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
