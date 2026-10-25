import { promises as fs, constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSkinEditVpk } from './skinEditor';
import { heroSkinSourceFingerprint } from './heroPoseModels';
import { skinEditSaveSchema, skinEditSourceSchema } from '../../../src/lib/skinEditSchema';
import { allocateEnabledVpkPath, deleteModsUnlocked, enableModUnlocked, reorderModsUnlocked, runExclusiveModMutation, scanMods, type Mod } from './mods';
import { assertVpkSafety } from './modSafety';
import { assertCanMoveLoadedGameMods, syncRunningGameModSnapshotFromMods } from './gameSessionMods';
import { metaKeyFor, isPriorityFolderPath } from './deadlock';
import { getModMetadata, setModMetadataWithHash, removeModMetadata } from './metadata';
import { resolveVpkIdentity } from './vpkIdentity';
import { notifyModChanges } from './modChangeObservation';
import { resolveSkinEditSources, sameSkinEditTarget, skinEditTarget, skinOverlayLoadOrder, type ResolvedSkinEditSources } from './skinOverlay';
import type { SkinEditResume, SkinEditSaveResult, SkinEditSource } from '../../../src/types/skinEditor';
import type { HeroPoseSkinSource } from '../../../src/types/portrait';

/** Swaps any skin-editor overlay in `requested` for the installed skins it was made from. Global skins never match. */
async function resolveInstalledSkinEditSources(mods: Mod[], requested: HeroPoseSkinSource[]): Promise<ResolvedSkinEditSources> {
    const candidates = mods.filter((mod) => !isPriorityFolderPath(mod.path)).map((mod) => {
        const metadata = getModMetadata(mod.metaKey);
        return { mod, metaKey: mod.metaKey, priority: mod.priority, enabled: mod.enabled, sha256: metadata?.sha256, skinEdit: metadata?.skinEdit };
    });
    const resolved = resolveSkinEditSources(requested, candidates);
    if (!resolved.missing.length) return resolved;
    // Only a mod without a stored hash can still match. Hash those before calling a source missing.
    for (const candidate of candidates) {
        candidate.sha256 ??= await resolveVpkIdentity(candidate.mod.path).then((identity) => identity.sha256, () => undefined);
    }
    return resolveSkinEditSources(requested, candidates);
}

export async function resumeSkinEdit(deadlockPath: string, input: SkinEditSource): Promise<SkinEditResume> {
    const request = skinEditSourceSchema.parse(input);
    const { skinSources, overlay, edits, missing } = await resolveInstalledSkinEditSources(await scanMods(deadlockPath), request.skinSources);
    return {
        skinSources, edits, missing: missing.length,
        overlay: overlay && { metaKey: overlay.metaKey, priority: overlay.priority },
        name: overlay && getModMetadata(overlay.metaKey)?.modName,
    };
}

export async function saveSkinEdits(deadlockPath: string, input: unknown): Promise<SkinEditSaveResult> {
    const request = skinEditSaveSchema.parse(input);
    const { name, thumbnailDataUrl, ...editRequest } = request;
    // An overlay named as a source is resumed: build from its own sources and replace it.
    const resolved = await resolveInstalledSkinEditSources(await scanMods(deadlockPath), request.skinSources);
    if (resolved.missing.length) throw new Error('Some source skins are no longer installed. Restore them before saving.');
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-skin-save-'));
    try {
        const out = join(dir, 'skin_dir.vpk');
        const entry = await buildSkinEditVpk(deadlockPath, { ...editRequest, skinSources: resolved.skinSources }, out);
        await assertVpkSafety(out, { context: 'installation', name });
        const saved = await runExclusiveModMutation(async () => {
            const before = await scanMods(deadlockPath);
            await syncRunningGameModSnapshotFromMods(before);
            const sources = resolved.skinSources.map((source) => {
                const mod = before.find((item) => item.metaKey === source.metaKey);
                if (!mod) throw new Error('The source skin changed. Reload the editor before saving.');
                return mod;
            });
            if (await heroSkinSourceFingerprint(deadlockPath, resolved.skinSources, entry) !== request.fingerprint) {
                throw new Error('The source skin or game changed. Reload the editor before saving.');
            }
            const target = skinEditTarget(request.heroName, await Promise.all(sources.map(async (mod) =>
                getModMetadata(mod.metaKey)?.sha256 ?? (await resolveVpkIdentity(mod.path)).sha256)));
            const resumed = (mod: Mod) => mod.metaKey === resolved.overlay?.metaKey && sameSkinEditTarget(getModMetadata(mod.metaKey)?.skinEdit, resolved.overlay.skinEdit);
            const replaced = before.filter((mod) => !sources.includes(mod) && (resumed(mod) || sameSkinEditTarget(getModMetadata(mod.metaKey)?.skinEdit, target)));
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
                    modName: request.name, sourceSection: 'SkinEdit', categoryName: 'Skins', skinEdit: { ...target, edits: request.edits },
                    thumbnailUrl: thumbnailDataUrl ?? replaced.map((mod) => getModMetadata(mod.metaKey)?.thumbnailUrl).find(Boolean),
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
            return { renamed: result, overlay: located(moved.get(key) ?? key) };
        }, { healPath: deadlockPath });
        notifyModChanges();
        return saved;
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
