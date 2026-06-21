/**
 * Foundry tab IPC: thin handlers over the foundryCatalog service. Each resolves
 * the active Deadlock path (dev-aware) and throws a friendly error when it is
 * unset, so the renderer's catch surfaces the "set your game path" empty state
 * rather than a raw spawn failure.
 */
import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import {
    getHeroRoster,
    getHeroSounds,
    getTextures,
    getVoicelines,
    ensureCategoryThumbnails,
    ensureFullImage,
    ensureVoiceclip,
    warmCache,
} from '../services/foundryCatalog';
import type {
    HeroInfo,
    HeroSound,
    HeroSoundFilters,
    TextureCategory,
    TextureEntry,
    TextureFilters,
    TextureGridItem,
    VoiceLine,
    VoicelineFilters,
} from '../../../src/types/foundry';

function requireDeadlockPath(): string {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured. Set it in Settings first.');
    }
    return deadlockPath;
}

ipcMain.handle('foundry:heroes', async (): Promise<HeroInfo[]> => {
    return getHeroRoster(requireDeadlockPath());
});

ipcMain.handle(
    'foundry:textures',
    async (_e, filters: TextureFilters = {}): Promise<TextureEntry[]> => {
        return getTextures(requireDeadlockPath(), filters);
    }
);

ipcMain.handle(
    'foundry:ensureThumbnails',
    async (_e, category: TextureCategory): Promise<TextureGridItem[]> => {
        return ensureCategoryThumbnails(requireDeadlockPath(), category);
    }
);

ipcMain.handle(
    'foundry:voicelines',
    async (_e, filters: VoicelineFilters = {}): Promise<VoiceLine[]> => {
        return getVoicelines(requireDeadlockPath(), filters);
    }
);

ipcMain.handle(
    'foundry:heroSounds',
    async (_e, filters: HeroSoundFilters = {}): Promise<HeroSound[]> => {
        return getHeroSounds(requireDeadlockPath(), filters);
    }
);

ipcMain.handle(
    'foundry:fullImage',
    async (_e, category: TextureCategory, entryPath: string): Promise<string | null> => {
        return ensureFullImage(requireDeadlockPath(), category, entryPath);
    }
);

ipcMain.handle(
    'foundry:voiceclip',
    async (_e, vsndPath: string): Promise<string | null> => {
        return ensureVoiceclip(requireDeadlockPath(), vsndPath);
    }
);

ipcMain.handle('foundry:warmCache', async (): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) return; // nothing to warm; silent (called opportunistically)
    await warmCache(deadlockPath);
});
