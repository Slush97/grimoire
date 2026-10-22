import { promises as fs, constants } from 'fs';
import { basename, dirname, join } from 'path';
import { tmpdir } from 'os';
import { buildSkinEditVpk } from './skinEditor';
import { skinEditSaveSchema } from '../../../src/lib/skinEditSchema';
import { allocateEnabledVpkPath, enableModUnlocked, reorderModsUnlocked, runExclusiveModMutation, scanMods } from './mods';
import { assertVpkSafety } from './modSafety';
import { metaKeyFor, getAddonsPath, isPriorityFolderPath } from './deadlock';
import { setModMetadataWithHash, removeModMetadata } from './metadata';
import { notifyModChanges } from './modChangeObservation';

export async function saveSkinEdits(deadlockPath: string, input: unknown): Promise<void> {
    const request = skinEditSaveSchema.parse(input);
    const { name, ...editRequest } = request;
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-skin-save-'));
    try {
        const out = join(dir, 'skin_dir.vpk');
        await buildSkinEditVpk(deadlockPath, editRequest, out);
        await assertVpkSafety(out, { context: 'installation', name });
        await runExclusiveModMutation(async () => {
            const before = await scanMods(deadlockPath);
            for (const source of request.skinSources) {
                const mod = before.find((item) => item.metaKey === source.metaKey);
                if (!mod) throw new Error('The source skin changed. Reload the editor before saving.');
                if (!mod.enabled) await enableModUnlocked(deadlockPath, mod.id);
            }
            const destination = await allocateEnabledVpkPath(deadlockPath);
            if (dirname(destination) !== getAddonsPath(deadlockPath)) throw new Error('The main add-ons folder is full. Free a slot before saving this skin overlay.');
            await fs.copyFile(out, destination, constants.COPYFILE_EXCL);
            const key = metaKeyFor(destination);
            try {
                removeModMetadata(key);
                await setModMetadataWithHash(key, {
                    modName: request.name, sourceSection: 'SkinEdit', categoryName: 'Skins',
                    lockerHero: request.heroName, lockerHeroSource: 'manual', lockerHeroVpkChecked: true,
                }, destination);
                const mods = (await scanMods(deadlockPath)).filter((mod) => mod.enabled && !isPriorityFolderPath(mod.path));
                const overlay = mods.find((mod) => mod.fileName === basename(destination) && mod.metaKey === key);
                if (!overlay) throw new Error('The saved skin could not be found.');
                const base = mods.filter((mod) => mod.id !== overlay.id && dirname(mod.path) === getAddonsPath(deadlockPath));
                const overflow = mods.filter((mod) => dirname(mod.path) !== getAddonsPath(deadlockPath));
                await reorderModsUnlocked(deadlockPath, [...base, overlay, ...overflow].map((mod) => mod.id));
            } catch (error) {
                await fs.unlink(destination).catch(() => {});
                removeModMetadata(key);
                throw error;
            }
        }, { healPath: deadlockPath });
        notifyModChanges();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
