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
import { buildHeroEffectVpkForExport } from '../services/heroColors';
import { exportVpkViaDialog } from '../services/foundryExport';
import { exportFoundryAsset } from '../services/foundryAssetExport';
import { getSkinEditInfo, exportSkinEdits, skinEditSourceSchema } from '../services/skinEditor';
import { hideoutBuildProgress, hideoutSceneReady, loadHideoutScene, saveHideoutSnapshot } from '../services/hideoutScene';
import { resumeSkinEdit, saveSkinEdits } from '../services/saveSkinEdits';
import { previewMovementFx, previewMovementEngine, exportMovementFx, saveMovementFx } from '../services/movementFx';
import type {
    HeroEffectExportRequest,
    HeroInfo,
    HeroSound,
    HeroSoundFilters,
    TextureCategory,
    TextureEntry,
    TextureFilters,
    TextureGridItem,
    VoiceLine,
    VoicelineFilters,
    VpkExportResult,
} from '../../../src/types/foundry';

function requireDeadlockPath(): string {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured. Set it in Settings first.');
    }
    return deadlockPath;
}

ipcMain.handle('foundry:skinEditInfo', (_event, input: unknown) =>
    getSkinEditInfo(requireDeadlockPath(), skinEditSourceSchema.parse(input)));
ipcMain.handle('foundry:resumeSkinEdit', (_event, input: unknown) =>
    resumeSkinEdit(requireDeadlockPath(), skinEditSourceSchema.parse(input)));
ipcMain.handle('foundry:exportSkinEdits', (_event, input: unknown) => exportSkinEdits(requireDeadlockPath(), input));
ipcMain.handle('foundry:saveSkinEdits', (event, input: unknown) => saveSkinEdits(requireDeadlockPath(), input, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('foundry:skinEditProgress', progress);
}));
ipcMain.handle('viewer:hideout', () => loadHideoutScene(requireDeadlockPath()));
ipcMain.handle('viewer:hideoutProgress', () => hideoutBuildProgress());
ipcMain.handle('viewer:hideoutReady', () => {
    const deadlockPath = getActiveDeadlockPath();
    return deadlockPath ? hideoutSceneReady(deadlockPath) : false;
});
ipcMain.handle('viewer:hideoutSnapshot', (_event, key: unknown, name: unknown, bytes: unknown) => {
    if (typeof key !== 'string' || typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('Invalid hideout snapshot.');
    return saveHideoutSnapshot(key, name, bytes);
});
ipcMain.handle('foundry:previewMovementFx', (_event, input: unknown) => previewMovementFx(requireDeadlockPath(), input));
ipcMain.handle('foundry:previewMovementEngine', (_event, input: unknown) => previewMovementEngine(requireDeadlockPath(), input));
ipcMain.handle('foundry:exportMovementFx', (_event, input: unknown) => exportMovementFx(requireDeadlockPath(), input));
ipcMain.handle('foundry:saveMovementFx', (_event, input: unknown) => saveMovementFx(requireDeadlockPath(), input));

ipcMain.handle('foundry:exportAsset', async (_e, request: unknown): Promise<VpkExportResult> => {
    return exportFoundryAsset(requireDeadlockPath(), request);
});

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

// Bake a hero ability-VFX effect (recolor / prism / gradient / trippy) into a
// standalone addon VPK and let the user save it to disk, instead of applying it
// into the managed mod list. Reuses the apply path's cached per-hero bake, then
// opens a native save dialog. Returns { exported: false } if the user cancels.
ipcMain.handle(
    'foundry:exportHeroEffect',
    async (_e, req: HeroEffectExportRequest): Promise<VpkExportResult> => {
        const { vpkPath, suggestedName } = await buildHeroEffectVpkForExport(
            requireDeadlockPath(),
            req
        );
        return exportVpkViaDialog(vpkPath, suggestedName);
    }
);
