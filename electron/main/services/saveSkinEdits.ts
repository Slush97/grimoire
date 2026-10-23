import { promises as fs, constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSkinEditVpk } from './skinEditor';
import { heroSkinSourceFingerprint } from './heroPoseModels';
import { skinEditSaveSchema } from '../../../src/lib/skinEditSchema';
import { allocateEnabledVpkPath, deleteModsUnlocked, enableModUnlocked, reorderModsUnlocked, runExclusiveModMutation, scanMods, type Mod } from './mods';
import { assertVpkSafety } from './modSafety';
import { assertCanMoveLoadedGameMods, syncRunningGameModSnapshotFromMods } from './gameSessionMods';
import { metaKeyFor, isPriorityFolderPath } from './deadlock';
import { getModMetadata, setModMetadataWithHash, removeModMetadata } from './metadata';
import { resolveVpkIdentity } from './vpkIdentity';
import { notifyModChanges } from './modChangeObservation';
import { sameSkinEditTarget, skinEditTarget, skinOverlayLoadOrder } from './skinOverlay';
import type { SkinEditSaveResult } from '../../../src/types/skinEditor';
import type { HeroPoseSkinSource } from '../../../src/types/portrait';

export async function saveSkinEdits(deadlockPath: string, input: unknown): Promise<SkinEditSaveResult> {
    const request = skinEditSaveSchema.parse(input);
    const { name, ...editRequest } = request;
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-skin-save-'));
    try {
        const out = join(dir, 'skin_dir.vpk');
        const entry = await buildSkinEditVpk(deadlockPath, editRequest, out);
        await assertVpkSafety(out, { context: 'installation', name });
        const renamed = await runExclusiveModMutation(async () => {
            const before = await scanMods(deadlockPath);
            await syncRunningGameModSnapshotFromMods(before);
            const sources = request.skinSources.map((source) => {
                const mod = before.find((item) => item.metaKey === source.metaKey);
                if (!mod) throw new Error('The source skin changed. Reload the editor before saving.');
                return mod;
            });
            if (await heroSkinSourceFingerprint(deadlockPath, request.skinSources, entry) !== request.fingerprint) {
                throw new Error('The source skin or game changed. Reload the editor before saving.');
            }
            const target = skinEditTarget(request.heroName, await Promise.all(sources.map(async (mod) =>
                getModMetadata(mod.metaKey)?.sha256 ?? (await resolveVpkIdentity(mod.path)).sha256)));
            const replaced = before.filter((mod) => !sources.includes(mod) && sameSkinEditTarget(getModMetadata(mod.metaKey)?.skinEdit, target));
            assertCanMoveLoadedGameMods(replaced);
            const enabledSources: Mod[] = [];
            for (const mod of sources) enabledSources.push(mod.enabled ? mod : await enableModUnlocked(deadlockPath, mod.id));
            const destination = await allocateEnabledVpkPath(deadlockPath);
            await fs.copyFile(out, destination, constants.COPYFILE_EXCL);
            const key = metaKeyFor(destination);
            let moved: Map<string, string>;
            try {
                removeModMetadata(key);
                await setModMetadataWithHash(key, {
                    modName: request.name, sourceSection: 'SkinEdit', categoryName: 'Skins', skinEdit: target,
                    lockerHero: request.heroName, lockerHeroSource: 'manual', lockerHeroVpkChecked: true,
                }, destination);
                const enabled = (await scanMods(deadlockPath)).filter((mod) => mod.enabled && !isPriorityFolderPath(mod.path));
                const overlay = enabled.find((mod) => mod.metaKey === key);
                if (!overlay) throw new Error('The saved skin could not be found.');
                moved = await reorderModsUnlocked(deadlockPath, skinOverlayLoadOrder(enabled.map((mod) => mod.id), overlay.id,
                    new Set(enabledSources.map((mod) => mod.id)), new Set(replaced.map((mod) => mod.id))));
            } catch (error) {
                // A reorder that throws has moved nothing or rolled its renames back, so this is still the overlay.
                await fs.unlink(destination).catch(() => {});
                removeModMetadata(key);
                throw error;
            }
            if (replaced.length) await deleteModsUnlocked(deadlockPath, replaced.map(({ id, size, installedAt }) => ({ id, size, installedAt })));
            const after = await scanMods(deadlockPath);
            const located = (metaKey: string) => ({ metaKey, priority: after.find((item) => item.metaKey === metaKey)?.priority ?? 0 });
            const result: Record<string, HeroPoseSkinSource> = {};
            for (const [from, to] of moved) result[from] = located(to);
            sources.forEach((mod, index) => {
                const metaKey = moved.get(enabledSources[index].metaKey) ?? enabledSources[index].metaKey;
                if (metaKey !== mod.metaKey) result[mod.metaKey] = located(metaKey);
            });
            return result;
        }, { healPath: deadlockPath });
        notifyModChanges();
        return { renamed };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
