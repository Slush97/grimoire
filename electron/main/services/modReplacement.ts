import type { BrowserWindow } from 'electron';
import { inferHeroFromTitle } from '@grimoire/social-types/heroes';
import type { DownloadModArgs, RestoreLocalVariantGroupReplacementArgs } from '../../../src/types/electron';
import type { Mod } from '../../../src/types/mod';
import { planLocalVariantUpdateRestore } from '../../../src/lib/localVariantUpdateRestore';
import { findReplacementTargetIdsAfterInstall, modsByIds } from '../../../src/lib/replacementCleanup';
import {
    createEnabledVpkRestoreSnapshot,
    createGlobalVpkRestoreSnapshot,
    restoreReplacementVpkState,
} from '../../../src/lib/vpkRestore';
import { enqueueManagedDownload, type DownloadInstallResult } from './download';
import { getModMetadata, setModMetadata } from './metadata';
import {
    assertReplacementSafety,
    deleteModsUnlocked,
    enableModUnlocked,
    runExclusiveModMutation,
    scanMods,
    setModPriorityFolderUnlocked,
    type Mod as FilesystemMod,
} from './mods';
import { getActiveDeadlockPath, loadSettings } from './settings';
import { hasAnyImprint, imprintOneMod } from './imprintMods';
import { planLocalVariantReplacementRestore } from './localVariantReplacement';
import type { LocalVariantGroupMember } from './localVariantGroup';
import { GLOBAL_CLASSIFIER_VERSION } from './vpk';

/** Update planning needs stored identity, without running the UI's lazy VPK classifiers. */
export async function readReplacementMods(deadlockPath: string): Promise<Mod[]> {
    return (await scanMods(deadlockPath)).map((mod) => {
        const meta = getModMetadata(mod.metaKey);
        return {
            ...mod,
            name: meta?.modName || mod.name,
            gameBananaId: meta?.gameBananaId,
            gameBananaFileId: meta?.gameBananaFileId,
            vpkIndex: meta?.vpkIndex,
            archiveVpkPath: meta?.archiveVpkPath,
            sha256: meta?.sha256,
            sourceSection: meta?.sourceSection,
            categoryId: meta?.categoryId,
            fileDescription: meta?.fileDescription,
            sourceFileName: meta?.sourceFileName,
            localGroupId: meta?.localGroupId,
            priorityMod: meta?.priorityMod,
            ignoreUpdates: meta?.ignoreUpdates,
            merged: meta?.merged,
            lockerCosmetics: meta?.lockerCosmetics,
            lockerSounds: meta?.lockerSounds,
        };
    });
}

export function toLocalVariantGroupMember(mod: FilesystemMod): LocalVariantGroupMember {
    const meta = getModMetadata(mod.metaKey);
    const categoryHero = !meta?.lockerHero
        ? inferHeroFromTitle(meta?.categoryName || '') ?? undefined
        : undefined;
    return {
        id: mod.id,
        metaKey: mod.metaKey,
        name: meta?.modName ?? mod.name,
        gameBananaId: meta?.gameBananaId,
        localGroupId: meta?.localGroupId,
        lockerHero: meta?.lockerHero ?? categoryHero,
        lockerHeroSource: meta?.lockerHeroSource ?? (categoryHero ? 'title' : undefined),
        lockerHeroVpkChecked: meta?.lockerHeroVpkChecked,
        globalType: meta?.globalType,
        globalTypeClassifierVersion: meta?.globalTypeClassifierVersion,
        priorityMod: meta?.priorityMod,
        merged: !!meta?.merged,
    };
}

/** Best-effort refresh outside the non-reentrant mod mutation lock. */
export async function refreshEmbedAfterMetadataChange(
    deadlockPath: string,
    modId: string,
    metaKey: string,
    modPath: string,
): Promise<void> {
    try {
        if (!loadSettings().experimentalVpkImprinting) return;
        if (!getModMetadata(metaKey)?.imprinted && !hasAnyImprint(modPath)) return;
        await imprintOneMod(deadlockPath, modId);
    } catch (error) {
        console.warn(`[mods] Post-associate embed refresh failed for ${metaKey}:`, error);
    }
}

/** The caller holds runExclusiveModMutation while the old grouped member still exists. */
export async function restoreLocalVariantGroupReplacementUnlocked(
    deadlockPath: string,
    args: RestoreLocalVariantGroupReplacementArgs,
): Promise<FilesystemMod[]> {
    const all = await scanMods(deadlockPath);
    const members = all.map((mod) => ({
        ...toLocalVariantGroupMember(mod),
        gameBananaFileId: getModMetadata(mod.metaKey)?.gameBananaFileId,
    }));
    const plan = planLocalVariantReplacementRestore(members, args);
    const classification = {
        ...plan.classification,
        globalTypeClassifierVersion: plan.classification.globalTypeClassifierVersion ?? GLOBAL_CLASSIFIER_VERSION,
    };
    return plan.replacementMetaKeys.map((metaKey) => {
        const mod = all.find((candidate) => candidate.metaKey === metaKey);
        if (!mod) throw new Error(`Replacement metadata target disappeared: ${metaKey}`);
        setModMetadata(metaKey, { localGroupId: plan.groupId, modName: plan.modName, ...classification });
        return mod;
    });
}

type ReplacementSourceIdentity = Pick<Mod,
    'id' | 'gameBananaId' | 'gameBananaFileId' | 'sourceSection' | 'size' | 'installedAt' | 'sha256'
>;

function sameSourceIdentity(source: ReplacementSourceIdentity, target: Mod): boolean {
    return source.gameBananaId === target.gameBananaId &&
        source.gameBananaFileId === target.gameBananaFileId &&
        (source.sourceSection ?? 'Mod') === (target.sourceSection ?? 'Mod') &&
        source.size === target.size && source.installedAt === target.installedAt &&
        (!source.sha256 || source.sha256 === target.sha256);
}

function replacementSources(installed: readonly Mod[], sources: readonly Mod[], fileId: number): Mod[] {
    const targets = modsByIds(findReplacementTargetIdsAfterInstall(installed, sources, fileId), installed);
    const remaining = [...sources];
    for (const target of targets) {
        const index = remaining.findIndex((source) =>
            sameSourceIdentity(source, target) &&
            (source.id === target.id || source.vpkIndex === target.vpkIndex || !!source.sha256),
        );
        if (index === -1) throw new Error('The installed mod changed before its replacement was ready.');
        remaining.splice(index, 1);
    }
    if (remaining.length > 0) throw new Error('The installed mod changed before its replacement was ready.');
    return targets;
}

/** Enqueues synchronously. Capture and validation happen when this FIFO job starts. */
export function queueModReplacement(
    deadlockPath: string,
    args: DownloadModArgs,
    sourceModIds: string[],
    mainWindow: BrowserWindow | null,
    options: { expectedSources: readonly ReplacementSourceIdentity[]; promoteExisting?: boolean },
): Promise<DownloadInstallResult> {
    const devMode = loadSettings().devMode;
    const expected = options.expectedSources.map((source) => ({ ...source }));
    const sameSection = (mod: Mod) => (mod.sourceSection ?? 'Mod') === (args.section ?? 'Mod');
    const assertContext = () => {
        if (getActiveDeadlockPath() !== deadlockPath || loadSettings().devMode !== devMode) {
            throw new Error('The active mod folder changed before the update finished.');
        }
    };
    let sources: Mod[] = [];
    let promoted: Mod[] = [];
    let enabled: ReturnType<typeof createEnabledVpkRestoreSnapshot>;
    let global: ReturnType<typeof createGlobalVpkRestoreSnapshot>;
    return enqueueManagedDownload(deadlockPath, { ...args, replacementModIds: [...sourceModIds] }, mainWindow, {
        beforeStart: async () => {
            assertContext();
            const installed = await readReplacementMods(deadlockPath);
            sources = modsByIds([...new Set(sourceModIds)], installed);
            if (sources.length === 0 || sources.length !== new Set(sourceModIds).size || sources.some((source) =>
                source.gameBananaId !== args.modId || !sameSection(source) ||
                typeof source.gameBananaFileId !== 'number' || !!source.merged ||
                !expected.some((original) => original.id === source.id && sameSourceIdentity(original, source)),
            )) {
                throw new Error('The installed mod is no longer available for replacement.');
            }
            enabled = createEnabledVpkRestoreSnapshot(sources);
            global = createGlobalVpkRestoreSnapshot(sources);
            if (global.ambiguous) throw new Error('The installed mod has ambiguous Global placement.');
            if (options.promoteExisting) {
                const oldIds = new Set(sources.map((source) => source.id));
                promoted = installed.filter((mod) =>
                    sameSection(mod) && mod.gameBananaId === args.modId &&
                    mod.gameBananaFileId === args.fileId && !oldIds.has(mod.id),
                );
                if (promoted.length === 0) throw new Error('The installed replacement is no longer available.');
            }
        },
        ...(options.promoteExisting ? {
            execute: async (signal) => {
                await assertReplacementSafety(deadlockPath, promoted.map((mod) => mod.id), signal);
                return { installedVpks: promoted.map((mod) => mod.fileName) };
            },
        } : {}),
        afterInstall: async (result) => {
            assertContext();
            let refreshGroupEmbed = false;
            const failures = await runExclusiveModMutation(async () => {
                assertContext();
                let installed = (await readReplacementMods(deadlockPath)).filter(sameSection);
                const targets = replacementSources(installed, sources, args.fileId);
                const targetIds = targets.map((target) => target.id);
                const oldIds = new Set(targetIds);
                const replacementNames = new Set(result.installedVpks);
                const replacements = installed.filter((mod) =>
                    !oldIds.has(mod.id) && replacementNames.has(mod.fileName) &&
                    mod.gameBananaId === args.modId && mod.gameBananaFileId === args.fileId,
                );
                if (replacements.length === 0) throw new Error('The replacement mod was not installed.');

                const grouped = sources.some((source) => !!source.localGroupId);
                let group = planLocalVariantUpdateRestore(sources, installed, targetIds, args.modId, args.fileId);
                if (grouped && !group) throw new Error('The replacement could not retain its local variant group.');
                if (group && global.allGlobal) {
                    for (const mod of replacements) {
                        if (!mod.priorityMod) await setModPriorityFolderUnlocked(deadlockPath, mod.id, true);
                    }
                    installed = (await readReplacementMods(deadlockPath)).filter(sameSection);
                    group = planLocalVariantUpdateRestore(sources, installed, targetIds, args.modId, args.fileId);
                    if (!group) throw new Error('The replacement could not retain its Global variant group.');
                }
                if (group) {
                    await restoreLocalVariantGroupReplacementUnlocked(deadlockPath, group);
                    refreshGroupEmbed = true;
                }
                const { skipped } = await deleteModsUnlocked(deadlockPath, targets);
                if (skipped.length > 0) throw new Error('The installed mod changed before it could be replaced.');
                const fresh = (await readReplacementMods(deadlockPath)).filter((mod) =>
                    sameSection(mod) && mod.gameBananaId === args.modId && mod.gameBananaFileId === args.fileId,
                );
                return restoreReplacementVpkState(fresh, enabled, global, {
                    setGlobal: async (id) => { await setModPriorityFolderUnlocked(deadlockPath, id, true); },
                    enable: async (id) => { await enableModUnlocked(deadlockPath, id); },
                });
            }, { healPath: deadlockPath });
            if (refreshGroupEmbed) {
                assertContext();
                const installed = await readReplacementMods(deadlockPath);
                const fresh = installed.filter((mod) =>
                    sameSection(mod) && mod.gameBananaId === args.modId && mod.gameBananaFileId === args.fileId,
                );
                for (const mod of fresh) {
                    assertContext();
                    await refreshEmbedAfterMetadataChange(deadlockPath, mod.id, mod.metaKey, mod.path);
                }
            }
            if (failures.length > 0) {
                throw new Error(`The update was installed, but its enabled or Global state could not be restored: ${failures.map((failure) => String(failure.error)).join('; ')}`);
            }
        },
    });
}
