import { ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'fs';
import { extname, basename, join, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { loadSettings, saveSettings, getActiveDeadlockPath } from '../services/settings';
import {
    scanMods,
    enableMod,
    disableMod,
    deleteMod,
    setModPriority,
    reorderMods,
    swapModPriority,
    setModsEnabledBatch,
    setModPriorityFolder,
    allocateEnabledVpkPath,
    runExclusiveModMutation,
    type Mod,
} from '../services/mods';
import { metaKeyFor, isValidDeadlockPath } from '../services/deadlock';
import { getModMetadata, setModMetadata, setModMetadataWithHash, removeModMetadata, pruneOrphanMetadata } from '../services/metadata';
import { inferHeroFromTitle } from '@grimoire/social-types/heroes';
import { inferHeroFromVpk, classifyGlobalModFromVpk, GLOBAL_CLASSIFIER_VERSION, parseVpkDirectory, parseVpkDirectoriesAsync } from '../services/vpk';
import { classifyAbilitySoundsFromVpk } from '../services/abilitySounds';
import { migrateIgnoredConflictKeysForMods } from '../services/conflicts';
import { isLockerManaged } from '../services/lockerVpk';
import { retargetProfileModSha } from '../services/profiles';
import {
    detectUnknownModCacheMatches,
    detectUnknownModFilters,
    emptyCrcMatch,
    inferHeroFromVpkTree,
    type UnknownModCacheMatchInput,
    type UnknownModFilterGuess,
} from '../services/unknownModDetection';
import { downloadMod } from '../services/download';
import { fetchAdoptedThumbnail, type AdoptedThumbnailTarget } from '../services/adoptedThumbnail';
import { extractArchive, isArchive, type ExtractedVpk } from '../services/extract';
import {
    mergeMods,
    unmergeMod,
    extractMergeSource,
    addMergeSources,
    replaceMergeSources,
    reserveOutputSlot,
} from '../services/modMerger';
import {
    imprintOneMod,
    imprintAllInstalled,
    imprintPreflight,
    classifyEmbedFreshnessAt,
    computeAdoptionPatchAt,
    hasAdoptionFields,
    hasAnyImprint,
} from '../services/imprintMods';
import { parseAddonInfo, readEmbeddedAddonInfoText, readEmbeddedAddonInfo, carryForwardOriginalIdentity } from '../services/vpkIdentity';
import { readEmbeddedModinfo, readLegacyGrimoireMergeMeta, hasLegacyGrimoireMergeMetaEntry } from '../services/modinfoFormat';
import { buildHeroSoundSwapVpk, cleanupHeroSoundSwapBuild } from '../services/foundryCatalog';
import { buildSoulContainerVpk, cleanupSoulContainerBuild, previewSoulContainerGlb } from '../services/soulContainerImport';
import { buildSpiritUrnVpk, cleanupSpiritUrnBuild, previewSpiritUrnGlb } from '../services/spiritUrnImport';
import { resolveModVpk, clearSoulModelCache } from '../services/soulContainerModels';
import { exportVpkViaDialog, exportVpkFileName } from '../services/foundryExport';
import { getMainWindow } from '../index';
import type { ImportCustomModArgs, ImportCustomModsBatchArgs, ImportCustomModsBatchResult, ImportCustomModResult, ImportCustomModsProgress, ImportSoulContainerGlbArgs, PreviewSoulContainerGlbArgs, SoulContainerPreview, ImportSpiritUrnGlbArgs, PreviewSpiritUrnGlbArgs, SpiritUrnPreview } from '../../../src/types/electron';
import type { VpkExportResult, HeroSoundSwapRequest } from '../../../src/types/foundry';
import type { AbilitySoundClassification, AddMergeSourcesResult, MergeSourceReplacement, ReplaceMergeSourcesResult, ApplyUnknownCustomModArgs, ApplyUnknownModMatchArgs, AssociateUnknownModArgs, EditLocalModArgs, GlobalModType, LockerHeroSource, MergeModsArgs, Mod as WireMod, SoulContainerImportInfo, SoundSwapInfo, UrnImportInfo, UnmergeModResult, ExtractMergeSourceResult, UnknownModFileList, ImprintPreflightResult, ImprintDetails, PeekImprintResult } from '../../../src/types/mod';

const unknownDetectionControllers = new Map<string, AbortController>();

// Last path we warned about skipping the orphan prune for, so the warning lands
// once per path instead of once per get-mods.
let lastUntrustedPathWarned: string | null = null;

interface UnknownCacheBulkRequest {
    modId: string;
    requestId?: string;
}

/**
 * Copy a built or extracted VPK into an ENABLED slot.
 *
 * `allocateEnabledVpkPath` reserves nothing on disk, so between the allocate and
 * the copy a concurrent enable or download scans the folder, sees the same pakNN
 * as free, and renames its own VPK in: the copy then overwrites it and that mod
 * silently loses its file. Claiming the slot exclusively first closes that
 * window, the same way mergeMods does via reserveOutputSlot. A failed copy
 * removes the reservation so no 0-byte VPK is left for scanMods to pick up.
 *
 * `freshlyAllocated` is false when replacing one of our own earlier imports
 * (resolveModVpk returned an existing path), where the slot is already ours and
 * an exclusive create would fail with EEXIST.
 */
async function copyIntoModSlot(
    sourcePath: string,
    destPath: string,
    freshlyAllocated: boolean
): Promise<void> {
    if (!freshlyAllocated) {
        await fs.copyFile(sourcePath, destPath);
        return;
    }
    await reserveOutputSlot(destPath);
    try {
        await fs.copyFile(sourcePath, destPath);
    } catch (err) {
        try { await fs.unlink(destPath); } catch { /* ignore partial-output cleanup */ }
        throw err;
    }
}

/**
 * Enrich mod with metadata.
 *
 * For Sound mods without a stored lockerHero, lazily infer one from the mod
 * name and persist it. The infer call is cheap (substring + a few regexes per
 * hero) but writing back means follow-up scans skip the work and the manual
 * override path has a stable field to overwrite.
 */
/**
 * Resolve a mod's Locker global type, classifying from the VPK tree when it has
 * not been classified yet OR when an older classifier version produced a stale
 * `null` ("not global") result. A positive type is left untouched: it may be a
 * manual override, and re-running can't improve a confident hit. Runs for mods
 * with no metadata row too (a VPK dropped straight into citadel/addons), so
 * locally added HUD / Soul Container mods get tagged like downloaded ones.
 * Persists the result + classifier version so later scans skip the re-parse.
 */
function resolveGlobalType(
    mod: Mod,
    metadata: ReturnType<typeof getModMetadata>
): import('../../../src/types/mod').GlobalModType | null {
    const current = metadata?.globalType;
    const stamped = metadata?.globalTypeClassifierVersion ?? 0;
    const needsClassify =
        current === undefined || (current === null && stamped < GLOBAL_CLASSIFIER_VERSION);
    if (!needsClassify) return current;
    let classified: ReturnType<typeof classifyGlobalModFromVpk> = null;
    try {
        classified = classifyGlobalModFromVpk(mod.path);
    } catch (err) {
        console.warn(`[enrichMod] VPK global-type classification failed for ${mod.fileName}:`, err);
    }
    setModMetadata(mod.metaKey, {
        globalType: classified,
        globalTypeClassifierVersion: GLOBAL_CLASSIFIER_VERSION,
    });
    return classified;
}

/**
 * File-tree hero tag for UNKNOWN mods. Known mods get their hero from the
 * GameBanana category; unknown skins have no metadata, so we infer the hero
 * from the VPK tree (inferHeroFromVpkTree, which recognizes skins, not just
 * sound mods) and tag it like a downloaded mod so the Locker chip + icon show.
 * Only accepts a confident (strong/medium) signal to avoid mislabeling, and
 * stamps lockerHeroVpkChecked so a "no hero found" result isn't re-parsed every
 * scan. A recognized global cosmetic (soul container, HUD, ...) isn't per-hero,
 * so it's skipped entirely.
 */
function resolveUnknownLockerHero(
    mod: Mod,
    metadata: ReturnType<typeof getModMetadata>,
    isUnknown: boolean,
    globalType: GlobalModType | null
): { lockerHero?: string; lockerHeroSource?: LockerHeroSource } {
    if (!isUnknown) return {};
    if (metadata?.lockerHero) {
        return { lockerHero: metadata.lockerHero, lockerHeroSource: metadata.lockerHeroSource };
    }
    if (globalType) return {};
    if (metadata?.lockerHeroVpkChecked) return {};

    let lockerHero: string | undefined;
    let lockerHeroSource: LockerHeroSource | undefined;
    try {
        const guess = inferHeroFromVpkTree(mod.path);
        if (guess && guess.strongestSignal !== 'weak') {
            lockerHero = guess.name;
            lockerHeroSource = 'vpk';
        }
    } catch (err) {
        console.warn(`[enrichMod] VPK-tree hero inference failed for ${mod.fileName}:`, err);
    }
    setModMetadata(mod.metaKey, { lockerHero, lockerHeroVpkChecked: true });
    return { lockerHero, lockerHeroSource };
}

function enrichMod(mod: Mod): WireMod {
    const metadata = getModMetadata(mod.metaKey);
    const isUnknown =
        !metadata?.gameBananaId &&
        !(typeof metadata?.modName === 'string' && metadata.modName.trim().length > 0);
    // Classify the global (non-hero) cosmetic type for EVERY scanned VPK, even
    // ones with no metadata row, so locally added mods get tagged like
    // downloaded ones. resolveGlobalType persists the result + classifier
    // version so subsequent scans skip the parse.
    const globalType = resolveGlobalType(mod, metadata);
    if (metadata) {
        let lockerHero = metadata.lockerHero;
        let lockerHeroSource = metadata.lockerHeroSource;
        if (!lockerHero && metadata.sourceSection === 'Sound') {
            // Title match first because it's O(1) regex; only crack open the
            // VPK if the title gave us nothing. The VPK path is authoritative
            // (parses real Source 2 codenames like `ghost` → Lady Geist) but
            // costs a disk read + directory tree parse per call.
            let inferred: string | null = inferHeroFromTitle(metadata.modName || mod.name);
            let inferredSource: typeof lockerHeroSource = inferred ? 'title' : undefined;
            if (!inferred) {
                try {
                    inferred = inferHeroFromVpk(mod.path);
                    inferredSource = inferred ? 'vpk' : undefined;
                } catch (err) {
                    console.warn(`[enrichMod] VPK hero inference failed for ${mod.fileName}:`, err);
                }
            }
            if (inferred) {
                setModMetadata(mod.metaKey, { lockerHero: inferred, lockerHeroSource: inferredSource });
                lockerHero = inferred;
                lockerHeroSource = inferredSource;
            }
        } else if (!lockerHero && isUnknown) {
            // Unknown mod (no GameBanana category to lean on): tag the hero from
            // the VPK tree so the card/Locker show the same chip as known mods.
            const resolved = resolveUnknownLockerHero(mod, metadata, isUnknown, globalType);
            lockerHero = resolved.lockerHero;
            lockerHeroSource = resolved.lockerHeroSource;
        }
        // Per-ability sound footprint. Same lazy + persist + null-sentinel
        // pattern as globalType, and it shares the cached VPK parse, so the two
        // classifications cost one directory read between them. Lets the
        // per-ability sound picker know which abilities a mod offers a sound for.
        let abilitySounds = metadata.abilitySounds;
        if (abilitySounds === undefined) {
            let classified: AbilitySoundClassification | null = null;
            try {
                const result = classifyAbilitySoundsFromVpk(mod.path);
                // Store null ("checked, none") unless a recognized hero matched,
                // so skins and non-sound mods skip the re-parse on later scans.
                classified = result && result.dominantHero ? result : null;
            } catch (err) {
                console.warn(`[enrichMod] VPK ability-sound classification failed for ${mod.fileName}:`, err);
            }
            setModMetadata(mod.metaKey, { abilitySounds: classified });
            abilitySounds = classified;
        }
        return {
            ...mod,
            // Use the stored mod name from GameBanana if available
            name: metadata.modName || mod.name,
            thumbnailUrl: metadata.thumbnailUrl,
            audioUrl: metadata.audioUrl,
            gameBananaId: metadata.gameBananaId,
            gameBananaFileId: metadata.gameBananaFileId,
            vpkIndex: metadata.vpkIndex,
            categoryId: metadata.categoryId,
            categoryName: metadata.categoryName,
            sourceSection: metadata.sourceSection,
            nsfw: metadata.nsfw,
            isArchived: metadata.isArchived,
            sha256: metadata.sha256,
            isUnknown,
            variantLabel: metadata.variantLabel,
            fileDescription: metadata.fileDescription,
            sourceFileName: metadata.sourceFileName,
            localGroupId: metadata.localGroupId,
            lockerHero,
            lockerHeroSource,
            globalType: globalType ?? undefined,
            merged: metadata.merged,
            forgeInstall: metadata.forgeInstall,
            lockerCosmetics: metadata.lockerCosmetics,
            lockerSounds: metadata.lockerSounds,
            abilitySounds: abilitySounds ?? undefined,
            soulImport: metadata.soulImport,
            urnImport: metadata.urnImport,
            ignoreUpdates: metadata.ignoreUpdates,
            priorityMod: metadata.priorityMod,
            imprinted: metadata.imprinted,
            imprintStale: metadata.imprintStale,
        };
    }
    // No metadata row (a VPK dropped straight into addons): still file-tree tag
    // the hero so unknown skins get their Locker chip like downloaded mods.
    const { lockerHero, lockerHeroSource } = resolveUnknownLockerHero(mod, metadata, isUnknown, globalType);
    return { ...mod, isUnknown, globalType: globalType ?? undefined, lockerHero, lockerHeroSource };
}

/**
 * Will enrichMod crack open this mod's VPK? Mirrors (conservatively
 * over-approximates) the lazy-classification predicates above: globalType not
 * yet classified at the current version, abilitySounds never checked, a Sound
 * mod with no hero tag yet (the parse only happens when title inference fails,
 * which we don't pre-compute; a wasted warm parse is harmless), or an unknown
 * mod whose tree hasn't been hero-checked. Every positive persists to
 * metadata, so this is a first-scan-only cost per mod.
 */
function needsVpkParseForEnrich(mod: Mod): boolean {
    const metadata = getModMetadata(mod.metaKey);
    const globalTypeStamped = metadata?.globalTypeClassifierVersion ?? 0;
    if (metadata?.globalType === undefined) return true;
    if (metadata.globalType === null && globalTypeStamped < GLOBAL_CLASSIFIER_VERSION) return true;
    if (metadata.abilitySounds === undefined) return true;
    if (!metadata.lockerHero && metadata.sourceSection === 'Sound') return true;
    const isUnknown =
        !metadata.gameBananaId &&
        !(typeof metadata.modName === 'string' && metadata.modName.trim().length > 0);
    if (isUnknown && !metadata.lockerHero && !metadata.lockerHeroVpkChecked) return true;
    return false;
}

function sameKeys(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((key, index) => key === b[index]);
}

function migrateIgnoredConflictKeysBeforeRenames(mods: Mod[]): void {
    const settings = loadSettings();
    const current = settings.ignoredConflicts ?? [];
    if (current.length === 0) return;

    const migrated = migrateIgnoredConflictKeysForMods(current, mods);
    if (!sameKeys(migrated, current)) {
        saveSettings({ ...settings, ignoredConflicts: migrated });
    }
}

// get-mods
ipcMain.handle('get-mods', async (): Promise<Mod[]> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return [];
    }
    const mods = await scanMods(deadlockPath);
    // Self-heal users whose metadata.json still carries orphan entries from
    // pre-fix deletes (issue #26). Skip while dev mode is active: the dev
    // sandbox starts empty, and pruning against it would wipe every real
    // install's name/thumbnail/gameBananaId from the global metadata sidecar.
    const settings = loadSettings();
    // Same reasoning, for the real install: an empty scan is only evidence that
    // the user has no mods when it came from a Deadlock folder that is actually
    // there. A configured path can stop resolving (Steam mid-update after a
    // reboot, a moved library, a drive that has not come up yet), and the scan
    // roots are created on demand by getAddonsPath/getGrimoirePath, so the scan
    // silently fabricates an empty addons tree and reports zero mods rather than
    // failing. Pruning against that deletes every name, id, thumbnail and hero
    // assignment the user has (reported 2026-08-14: 26 mods reduced to
    // "Pak01".."Pak31" after a PC restart). gameinfo.gi is the discriminator:
    // Steam ships it and nothing on the install path writes one.
    //
    // The devMode check stays load-bearing rather than redundant: setupDevMode
    // (services/dev.ts) writes an empty gameinfo.gi into the sandbox, so the
    // sandbox passes this test and would otherwise prune the real sidecar
    // against a tree that has never held a mod.
    const trustworthyScan = isValidDeadlockPath(deadlockPath);
    if (!trustworthyScan && deadlockPath !== lastUntrustedPathWarned) {
        // Once per path, not once per get-mods: this handler runs on every visit
        // to Installed, every toggle and every reorder, and a user whose
        // gameinfo.gi is genuinely missing (antivirus, partial verify) would
        // otherwise drown their own diagnostic report in this line.
        lastUntrustedPathWarned = deadlockPath;
        console.warn(
            `[Metadata] Skipping orphan prune: ${deadlockPath} has no game/citadel/gameinfo.gi, so this scan (${mods.length} VPKs) is not evidence of what is installed.`
        );
    }
    if (!settings.devMode && trustworthyScan) {
        // Prune against ALL scanned files (including managed VPKs) so we don't
        // wipe their metadata before filtering them out of the list below.
        pruneOrphanMetadata(new Set(mods.map((m) => m.metaKey)), deadlockPath);
    }
    // Hide Grimoire-managed Locker VPKs (hero cards + ability sounds). They're
    // driven solely through the Locker pickers and are auto-enabled + pinned to
    // the front of the load order (services/lockerVpk.ts), so surfacing them in
    // the Installed list would only let the user disable or reorder them and
    // silently break their applied cosmetics.
    const visible = mods.filter((m) => !isLockerManaged(m.metaKey));
    // Pre-warm the VPK parse cache across the worker pool for mods whose lazy
    // classifications will parse inside enrichMod below. enrichMod stays sync;
    // its parseVpkDirectoryCached calls hit the warmed cache instead of
    // sequentially pinning the main process (worst case: first scan after
    // importing a large collection).
    const warmPaths = visible.filter(needsVpkParseForEnrich).map((m) => m.path);
    if (warmPaths.length > 0) {
        await parseVpkDirectoriesAsync(warmPaths);
    }
    const enriched = visible.map(enrichMod);
    if (settings.verboseModTrace) {
        const hidden = mods.length - visible.length;
        // The renderer (Installed.tsx visibleMods) also hides disabled source
        // VPKs that are folded into a merged mod. Replicate its identity checks
        // here so the boundary line is honest about end-user visibility.
        const absorbedSources = enriched.flatMap((m) => m.merged?.sources ?? []);
        const matchesAbsorbedSource = (
            mod: WireMod,
            source: NonNullable<WireMod['merged']>['sources'][number]
        ): boolean => {
            if (mod.enabled || mod.fileName !== source.fileName) return false;

            const sourceSha = source.sha256AtMergeTime?.toLowerCase();
            const modSha = mod.sha256?.toLowerCase();
            if (sourceSha && modSha) return sourceSha === modSha;

            if (typeof source.gameBananaId === 'number' && typeof mod.gameBananaId === 'number') {
                if (source.gameBananaId !== mod.gameBananaId) return false;
                if (
                    typeof source.gameBananaFileId === 'number' &&
                    typeof mod.gameBananaFileId === 'number'
                ) {
                    return source.gameBananaFileId === mod.gameBananaFileId;
                }
            }

            // Mirror Installed.tsx: a disabled VPK at the exact recorded source
            // filename is the absorbed source (enabled mods already excluded), so
            // fold it in unless sha/gbId proved a different mod.
            return true;
        };
        const rendererHidden = enriched.filter((m) =>
            absorbedSources.some((source) => matchesAbsorbedSource(m, source))
        );
        console.log(
            `[modTrace] get-mods: scanned ${mods.length}, returning ${visible.length} to renderer ` +
                `(${hidden} locker-managed hidden; ${rendererHidden.length} more will be hidden by the renderer as merge sources)`
        );
        for (const m of rendererHidden) {
            console.log(
                `[modTrace]   RENDERER-HIDDEN disabled key=${m.metaKey} name="${m.name}" (identity matches a merged mod source -> absent from Installed list)`
            );
        }
    }
    return enriched;
});

// enable-mod
ipcMain.handle('enable-mod', async (_, modId: string): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mod = await enableMod(deadlockPath, modId);
    return enrichMod(mod);
});

// disable-mod
ipcMain.handle('disable-mod', async (_, modId: string): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mod = await disableMod(deadlockPath, modId);
    return enrichMod(mod);
});

// reveal-mod-in-folder
ipcMain.handle('reveal-mod-in-folder', async (_, modId: string): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mods = await scanMods(deadlockPath);
    const mod = mods.find((m) => m.id === modId);
    if (!mod) {
        throw new Error(`Mod not found: ${modId}`);
    }
    shell.showItemInFolder(mod.path);
});

// delete-mod
ipcMain.handle('delete-mod', async (_, modId: string): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    await deleteMod(deadlockPath, modId);
});

// detect-unknown-mod-filters
ipcMain.handle('detect-unknown-mod-filters', async (event, modId: string, requestId?: string): Promise<UnknownModFilterGuess> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mods = await scanMods(deadlockPath);
    const mod = mods.find((m) => m.id === modId);
    if (!mod) {
        throw new Error(`Mod not found: ${modId}`);
    }
    unknownDetectionControllers.get(modId)?.abort();
    const controller = new AbortController();
    unknownDetectionControllers.set(modId, controller);
    try {
        return await detectUnknownModFilters(mod.id, mod.fileName, mod.path, {
            signal: controller.signal,
            requestId,
            onProgress: (progress) => event.sender.send('unknown-mod-detection-progress', progress),
        });
    } finally {
        if (unknownDetectionControllers.get(modId) === controller) {
            unknownDetectionControllers.delete(modId);
        }
    }
});

// detect-unknown-mod-cache-bulk
ipcMain.handle(
    'detect-unknown-mod-cache-bulk',
    async (event, requests: UnknownCacheBulkRequest[]): Promise<UnknownModFilterGuess[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const mods = await scanMods(deadlockPath);
        const byId = new Map(mods.map((mod) => [mod.id, mod]));
        const inputs: UnknownModCacheMatchInput[] = [];
        const missing: UnknownModFilterGuess[] = [];

        for (const request of requests) {
            const mod = byId.get(request.modId);
            if (!mod) {
                missing.push({
                    modId: request.modId,
                    fileName: '',
                    fileCount: 0,
                    section: 'Mod',
                    search: null,
                    confidence: 'low',
                    contentHints: [],
                    reasons: [`Mod not found: ${request.modId}`],
                    detectedHeroes: [],
                    samplePaths: [],
                    crcMatch: emptyCrcMatch('not-found', `Mod not found: ${request.modId}`),
                });
                continue;
            }
            inputs.push({
                modId: mod.id,
                fileName: mod.fileName,
                vpkPath: mod.path,
                requestId: request.requestId,
            });
        }

        const results = await detectUnknownModCacheMatches(inputs, {
            onProgress: (progress) => event.sender.send('unknown-mod-detection-progress', progress),
        });
        return [...results, ...missing];
    }
);

// cancel-unknown-mod-detection
ipcMain.handle('cancel-unknown-mod-detection', async (_, modId: string): Promise<void> => {
    const controller = unknownDetectionControllers.get(modId);
    if (controller) {
        controller.abort();
        unknownDetectionControllers.delete(modId);
    }
});

// apply-unknown-mod-match
ipcMain.handle(
    'apply-unknown-mod-match',
    async (_, modId: string, match: ApplyUnknownModMatchArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        if (!match || !Number.isFinite(match.gameBananaId) || !match.modName?.trim()) {
            throw new Error('Invalid GameBanana match');
        }
        const matchFileId = match.gameBananaFileId;
        const matchFileName = match.sourceFileName?.trim();
        if (matchFileId === undefined || !Number.isFinite(matchFileId) || !matchFileName) {
            throw new Error('The matched GameBanana file is missing download information');
        }

        unknownDetectionControllers.get(modId)?.abort();
        unknownDetectionControllers.delete(modId);

        const mods = await scanMods(deadlockPath);
        const target = mods.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }

        const wasEnabled = target.enabled;
        const downloadResult = await downloadMod(deadlockPath, {
            modId: match.gameBananaId,
            fileId: matchFileId,
            fileName: matchFileName,
            modName: match.modName,
            section: match.sourceSection ?? 'Mod',
        }, getMainWindow());
        const installedFileNames = new Set(downloadResult.installedVpks);

        const afterDownload = await scanMods(deadlockPath);
        const downloaded = afterDownload
            .filter((candidate) => {
                if (candidate.id === target.id) return false;
                return installedFileNames.has(candidate.fileName);
            })
            .sort((a, b) => downloadResult.installedVpks.indexOf(a.fileName) - downloadResult.installedVpks.indexOf(b.fileName));

        if (downloaded.length === 0) {
            throw new Error('Download completed, but the installed replacement VPK could not be found. The unknown mod was kept.');
        }

        await deleteMod(deadlockPath, target.id);

        const finalFileNames: string[] = [];
        if (wasEnabled) {
            for (const replacement of downloaded) {
                if (!replacement.enabled) {
                    const enabled = await enableMod(deadlockPath, replacement.id);
                    finalFileNames.push(enabled.fileName);
                } else {
                    finalFileNames.push(replacement.fileName);
                }
            }
        } else {
            finalFileNames.push(...downloaded.map((replacement) => replacement.fileName));
        }

        const finalMods = await scanMods(deadlockPath);
        const finalReplacement =
            finalMods.find((candidate) => candidate.fileName === finalFileNames[0]) ??
            downloaded[0];
        return enrichMod(finalReplacement ?? downloaded[0]);
    }
);

/**
 * Best-effort embed refresh after a metadata-changing handler (associate /
 * apply-custom / edit-local). A mod identified AFTER it was imprinted would
 * otherwise carry a stale embed until the next bulk run; refreshing here keeps
 * the embedded record in step with the sidecar the moment the user fixes it.
 *
 * Locking: these handlers do NOT run inside runExclusiveModMutation (they call
 * scanMods / setModMetadataWithHash directly, holding no lock), and the mod-
 * mutation lock is a non-reentrant queue, so nesting would deadlock ONLY if we
 * were already inside it. We are not: imprintOneMod acquires the lock itself,
 * so awaiting it here is safe. Awaited (not fire-and-forget) so the refresh is
 * serialized before the handler's response, but failures are swallowed: the
 * metadata change already succeeded, and a missed refresh just leaves the
 * embed stale until the next bulk imprint classifies it eligible again.
 *
 * apply-unknown-mod-match needs no call here: it installs a fresh replacement
 * (imprinted by the download path when the setting is on) and deletes the old
 * file, so no surviving file's sidecar is re-stamped.
 */
async function refreshEmbedAfterMetadataChange(
    deadlockPath: string,
    modId: string,
    metaKey: string,
    modPath: string
): Promise<void> {
    try {
        if (!loadSettings().experimentalVpkImprinting) return;
        // The sidecar flag alone misses a VPK dropped into addons mid-session:
        // the startup backfill has not seen it, so `imprinted` is unset even
        // though the file carries an embed, and bailing here would silently
        // leave the wrong embed in the file after the user just corrected the
        // identity. Consult the file itself too (the same predicate the
        // backfill and the import handler use). A foreign embed surviving to
        // imprintOneMod fails soft into the warn below, unchanged.
        if (!getModMetadata(metaKey)?.imprinted && !hasAnyImprint(modPath)) return;
        await imprintOneMod(deadlockPath, modId);
    } catch (err) {
        console.warn(`[mods] Post-associate embed refresh failed for ${metaKey}:`, err);
    }
}

// apply-unknown-custom-mod
ipcMain.handle(
    'apply-unknown-custom-mod',
    async (_, modId: string, args: ApplyUnknownCustomModArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        if (!args?.name?.trim()) {
            throw new Error('A name is required');
        }

        const mods = await scanMods(deadlockPath);
        const target = mods.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }

        await setModMetadataWithHash(target.metaKey, {
            modName: args.name.trim(),
            thumbnailUrl: args.thumbnailDataUrl,
            nsfw: !!args.nsfw,
        }, target.path);

        await refreshEmbedAfterMetadataChange(deadlockPath, target.id, target.metaKey, target.path);
        return enrichMod(target);
    }
);

// list-unknown-mod-files - read the raw file paths inside an unknown VPK so the
// user can eyeball what it touches before linking it. Pure local parse: no
// GameBanana calls, so it never trips the rate limiter.
ipcMain.handle('list-unknown-mod-files', async (_, modId: string): Promise<UnknownModFileList> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mods = await scanMods(deadlockPath);
    const target = mods.find((m) => m.id === modId);
    if (!target) {
        throw new Error(`Mod not found: ${modId}`);
    }
    const paths = parseVpkDirectory(target.path) ?? [];
    return { paths, fileCount: paths.length };
});

// associate-unknown-mod - manually link an unknown local VPK to a GameBanana mod
// the user picked via search. Tags the existing file in place (no download, no
// delete), so it costs zero archive fetches. Setting gameBananaId clears the
// isUnknown flag in enrichMod.
ipcMain.handle(
    'associate-unknown-mod',
    async (_, modId: string, args: AssociateUnknownModArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        if (!args || !Number.isFinite(args.gameBananaId) || !args.modName?.trim()) {
            throw new Error('A GameBanana mod selection is required');
        }

        const mods = await scanMods(deadlockPath);
        const target = mods.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }

        await setModMetadataWithHash(target.metaKey, {
            modName: args.modName.trim(),
            gameBananaId: args.gameBananaId,
            gameBananaFileId: args.gameBananaFileId,
            thumbnailUrl: args.thumbnailUrl,
            nsfw: !!args.nsfw,
            categoryName: args.categoryName,
            sourceSection: args.sourceSection,
        }, target.path);

        await refreshEmbedAfterMetadataChange(deadlockPath, target.id, target.metaKey, target.path);
        return enrichMod(target);
    }
);

// edit-local-mod - local/custom VPKs keep engine-safe pakNN filenames, so
// edits update the human-readable metadata shown in Grimoire.
ipcMain.handle(
    'edit-local-mod',
    async (_, modId: string, args: EditLocalModArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const trimmed = args?.name?.trim() ?? '';
        if (!trimmed) {
            throw new Error('A name is required');
        }

        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const existing = getModMetadata(target.metaKey) ?? {};
        if (typeof existing.gameBananaId === 'number' && existing.gameBananaId > 0) {
            throw new Error('Only local mods can be renamed');
        }

        await setModMetadataWithHash(target.metaKey, {
            modName: trimmed,
            thumbnailUrl: args.thumbnailDataUrl,
            nsfw: !!args.nsfw,
        }, target.path);

        await refreshEmbedAfterMetadataChange(deadlockPath, target.id, target.metaKey, target.path);
        return enrichMod(target);
    }
);

// set-variant-label - user-facing rename of a single VPK (the "variant"
// inside a grouped mod). Stored alongside the mod's other metadata so it
// survives priority renames via migrateModMetadata. An empty string clears
// the label and falls back to the filename-derived display.
ipcMain.handle(
    'set-variant-label',
    async (_, modId: string, label: string): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const trimmed = label.trim();
        setModMetadata(target.metaKey, {
            variantLabel: trimmed.length > 0 ? trimmed : undefined,
        });
        return enrichMod(target);
    }
);

// set-mod-locker-hero — manual hero tag for the Locker. Pass null to clear
// the override and fall back to categoryId / inferHeroFromTitle. Used from
// the Locker's "unassigned" section when GameBanana left a mod under the
// generic "Skins" parent (or when an author misspelled the hero name).
ipcMain.handle(
    'set-mod-locker-hero',
    async (_, modId: string, heroName: string | null): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const trimmed = heroName?.trim() ?? '';
        setModMetadata(target.metaKey, {
            lockerHero: trimmed.length > 0 ? trimmed : undefined,
            lockerHeroSource: trimmed.length > 0 ? 'manual' : undefined,
            ...(trimmed.length > 0 ? { globalType: undefined } : {}),
        });
        return enrichMod(target);
    }
);

// set-mod-global-type — manual override for the Locker's Global axis, used when
// the VPK-path classifier (classifyGlobalModType) misses a mod or files it
// under the wrong type. Pass a GlobalModType to assign it (this also clears any
// hero tag, since a mod lives on either the hero axis or the global axis, never
// both). Pass null to force it OFF the global axis: we persist the explicit null
// so the classifier doesn't just re-add it on the next scan. A positive type
// always wins over auto-classification (enrichMod never re-runs a positive
// result); the null is stamped with the current classifier version so a stale
// null re-run can't override this deliberate "not global" choice.
ipcMain.handle(
    'set-mod-global-type',
    async (_, modId: string, globalType: GlobalModType | null): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        setModMetadata(target.metaKey, {
            globalType,
            globalTypeClassifierVersion: GLOBAL_CLASSIFIER_VERSION,
            // Assigning a global type moves the mod off the hero axis.
            ...(globalType ? { lockerHero: undefined, lockerHeroSource: undefined } : {}),
        });
        return enrichMod(target);
    }
);

// set-mod-ignore-updates — manual opt-out from the update-available flag.
// Pass false to clear and resume normal update detection. Stored alongside
// other per-mod metadata so it survives priority renames.
ipcMain.handle(
    'set-mod-ignore-updates',
    async (_, modId: string, ignore: boolean): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        setModMetadata(target.metaKey, {
            ignoreUpdates: ignore ? true : undefined,
        });
        return enrichMod(target);
    }
);

// set-mod-priority: mark a mod Global (or clear it). Global mods move to the
// priority root citadel/grimoire, which gameinfo.gi lists ahead of
// citadel/addons, so they win every file collision without any load-order
// bookkeeping and the launch shuffle leaves them alone. Moving a mod is a
// folder mutation, so setModPriorityFolder takes the mutation lock.
ipcMain.handle(
    'set-mod-priority-folder',
    async (_, modId: string, priority: boolean): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        // enrichMod, like every sibling handler: the service returns a raw
        // scanned Mod, and the renderer's copy must carry the projected
        // sidecar fields (priorityMod included) or the card would drop its
        // Global chip until the next full reload.
        const mod = await setModPriorityFolder(deadlockPath, modId, priority);
        return enrichMod(mod);
    }
);

// backfill-gamebanana-file-id — heal legacy 1-click installs that were saved
// before we recovered the file id from the archive URL. The renderer matches
// a local variant to a GameBanana file row (by sourceFileName/fileName or by
// sole-file fallback) and asks us to persist the resolved id plus the file's
// canonical label fields, so both the per-file install state in
// ModDetailsModal and the variant picker's title flip to the right values on
// the next render. Label fields are only written when no existing value is
// present so a user's variantLabel rename never gets clobbered (the picker
// already prefers variantLabel over fileDescription, but we belt-and-brace
// against fileDescription/sourceFileName too).
interface BackfillPayload {
    gameBananaFileId: number;
    fileDescription?: string;
    sourceFileName?: string;
}
ipcMain.handle(
    'backfill-gamebanana-file-id',
    async (_, modId: string, payload: BackfillPayload): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const existing = getModMetadata(target.metaKey) ?? {};
        const patch: Record<string, unknown> = { gameBananaFileId: payload.gameBananaFileId };
        if (payload.fileDescription && !existing.fileDescription) {
            patch.fileDescription = payload.fileDescription;
        }
        // Overwrite sourceFileName only when missing or when it's the old
        // placeholder (gamebanana-mod-{timestamp}) — a real GB stem from a
        // working enrichment path is kept as-is.
        const placeholderName = existing.sourceFileName?.match(/^gamebanana-mod-\d+$/);
        if (payload.sourceFileName && (!existing.sourceFileName || placeholderName)) {
            patch.sourceFileName = payload.sourceFileName;
        }
        setModMetadata(target.metaKey, patch);
        return enrichMod(target);
    }
);

// set-mod-priority
ipcMain.handle(
    'set-mod-priority',
    async (_, modId: string, priority: number): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        migrateIgnoredConflictKeysBeforeRenames(await scanMods(deadlockPath));
        const mod = await setModPriority(deadlockPath, modId, priority);
        return enrichMod(mod);
    }
);

// reorder-mods
ipcMain.handle(
    'reorder-mods',
    async (_, orderedIds: string[]): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        migrateIgnoredConflictKeysBeforeRenames(await scanMods(deadlockPath));
        await reorderMods(deadlockPath, orderedIds);
        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
    }
);

// apply-mod-toggle-batch: disable a set then enable a set as one atomic
// mutation, returning the fresh mod list AND the per-mod failures. Backs the
// Locker skin randomizer. setModsEnabledBatch never rethrows a per-mod lock so
// one stuck VPK can't abort the batch; we surface the failure count instead of
// dropping it, so the renderer can warn that the shuffle only half-applied
// (otherwise a hero silently launches skinless and the call still looks green).
ipcMain.handle(
    'apply-mod-toggle-batch',
    async (_, enableIds: string[], disableIds: string[]): Promise<{ mods: Mod[]; failures: string[] }> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const result = await setModsEnabledBatch(deadlockPath, { enable: enableIds, disable: disableIds });
        const mods = await scanMods(deadlockPath);
        return { mods: mods.map(enrichMod), failures: result.failures };
    }
);

// swap-mod-priority
ipcMain.handle(
    'swap-mod-priority',
    async (_, modIdA: string, modIdB: string): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        migrateIgnoredConflictKeysBeforeRenames(await scanMods(deadlockPath));
        await swapModPriority(deadlockPath, modIdA, modIdB);
        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
    }
);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

async function readImageAsDataUrl(imagePath: string): Promise<string> {
    const ext = extname(imagePath).toLowerCase();
    const mime = IMAGE_MIME_BY_EXT[ext];
    if (!mime) {
        throw new Error(`Unsupported image type: ${ext}`);
    }
    const buf = await fs.readFile(imagePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
}

// read-glb-file
// Used by the soul-container import modal to render the selected local GLB
// directly in Three.js. The renderer cannot fetch arbitrary file:// paths under
// webSecurity, so main validates the extension and returns the bytes as base64.
ipcMain.handle('read-glb-file', async (_, glbPath: string): Promise<string> => {
    if (!glbPath || !existsSync(glbPath)) {
        throw new Error('GLB file not found');
    }
    if (extname(glbPath).toLowerCase() !== '.glb') {
        throw new Error('Selected file is not a .glb');
    }
    const buf = await fs.readFile(glbPath);
    return buf.toString('base64');
});

// read-image-data-url
// Used by the custom-mod import modal to preview a local image file. The renderer can't
// fetch file:// URLs under webSecurity; main reads and hands back a base64 data URL.
ipcMain.handle('read-image-data-url', async (_, imagePath: string): Promise<string> => {
    if (!imagePath || !existsSync(imagePath)) {
        throw new Error('Image file not found');
    }
    return readImageAsDataUrl(imagePath);
});

// read-renderer-asset
// Reads a BUNDLED renderer asset (e.g. built-in launcher art, a hero render) as a
// data URL. The Appearance crop editor needs the bytes to bake/frame a built-in
// image, but a packaged renderer is served from file:// where fetch() of a file://
// asset is blocked and a file:// <img> taints the canvas. Main reads it instead.
// Confined to the renderer output dir, traversal guarded.
const RENDERER_ASSET_ROOT = resolve(join(__dirname, '../renderer'));
ipcMain.handle('read-renderer-asset', async (_, relPath: string): Promise<string> => {
    if (typeof relPath !== 'string' || !relPath) {
        throw new Error('Invalid asset path');
    }
    // Drop any query/hash, then strip leading ./ or / so it resolves under the root.
    const clean = relPath.split(/[?#]/)[0].replace(/^[./]+/, '');
    const resolved = resolve(RENDERER_ASSET_ROOT, clean);
    if (resolved !== RENDERER_ASSET_ROOT && !resolved.startsWith(RENDERER_ASSET_ROOT + sep)) {
        throw new Error('Asset path escapes the renderer root');
    }
    if (!existsSync(resolved)) {
        throw new Error('Asset not found');
    }
    return readImageAsDataUrl(resolved);
});

/**
 * Import ONE local source (a bare `.vpk`, or an archive whose every contained
 * `.vpk` becomes its own slot) as tracked local mods. Returns how many mod slots
 * it wrote.
 *
 * The Deadlock engine requires strict `pakXX_dir.vpk` naming (see
 * apply-mina-variant), so custom imports always get a naked `pakNN_dir.vpk`
 * filename - no slug. The human-readable name lives in metadata.modName and is
 * shown in the UI instead.
 *
 * Archives are extracted to a temp dir and every contained `.vpk` is imported as
 * its own slot. This lets users drag the whole zip in (the reliable path) instead
 * of dragging a `.vpk` out of Windows' built-in zip viewer, which hands over a
 * virtual shell file with no on-disk path and locks the window while the OS
 * materializes it.
 *
 * LOCKING: the caller must run ONE call to this inside runExclusiveModMutation.
 * It allocates pakNN slots through the unlocked allocator, so without the lock a
 * concurrent Locker/Installed toggle can pick the same free slot and clobber the
 * copy (the same race the mutation queue exists to kill). One call is the whole
 * atomicity requirement: allocate -> copy must not interleave, but successive
 * calls may, since each re-scans for a free slot. A batch caller must therefore
 * take the lock per source, not around the loop, so a long batch doesn't stall
 * every other mod mutation in the app. Adopted-thumbnail fetches are queued onto
 * `thumbnailFetchTargets` rather than fired here, so the network work happens
 * after the lock is released.
 */
/** Filename stem of a source VPK, used as the honest `sourceFileName` fallback
 *  for locally imported mods (GameBanana downloads get theirs from the file
 *  record). Empty stems collapse to undefined so the label chain skips them. */
function localSourceFileStem(fileName: string): string | undefined {
    const stem = fileName.replace(/\.vpk$/i, '').trim();
    return stem.length > 0 ? stem : undefined;
}

/** Turn a source filename stem into a readable variant label ("galaxy_rem_gold"
 *  becomes "Galaxy Rem Gold"). Mirrors the archive-folder prettifier used for
 *  GameBanana multi-variant downloads. */
function prettifyLocalVariant(stem: string): string {
    return stem
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function importCustomModSource(
    deadlockPath: string,
    args: ImportCustomModArgs,
    thumbnailFetchTargets: AdoptedThumbnailTarget[]
): Promise<number> {
    const { vpkPath, name, thumbnailDataUrl, nsfw } = args;

    if (!vpkPath || !existsSync(vpkPath)) {
        throw new Error('File not found');
    }
    if (!name?.trim()) {
        throw new Error('A name is required');
    }
    const trimmedName = name.trim();

    const lower = vpkPath.toLowerCase();
    const isVpk = lower.endsWith('.vpk');
    if (!isVpk && !isArchive(vpkPath)) {
        throw new Error('Selected file is not a .vpk or supported archive (.zip, .7z, .rar)');
    }

    // Resolve the list of source VPKs to import. A bare .vpk is a single
    // source; an archive is extracted to a temp dir first and every VPK it
    // contains becomes its own import (extractArchive already filters to .vpk).
    let sourceVpks: ExtractedVpk[];
    let tempDir: string | undefined;
    if (isVpk) {
        sourceVpks = [{ path: vpkPath, fileName: basename(vpkPath) }];
    } else {
        tempDir = await fs.mkdtemp(join(tmpdir(), 'grimoire-import-'));
        try {
            sourceVpks = await extractArchive(vpkPath, tempDir);
        } catch (err) {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            throw err;
        }
        if (sourceVpks.length === 0) {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            throw new Error('No .vpk file was found inside the archive.');
        }
    }

    // A multi-VPK archive is one mod shipped as several interchangeable files,
    // so link its members with a freshly minted local group id: the Installed
    // page collapses them into one variant card exactly like a multi-file
    // GameBanana submission. The id is grouping state only (no provenance, no
    // meaning outside this install). A single-VPK import stays standalone.
    const localGroupId = sourceVpks.length > 1 ? randomUUID() : undefined;

    try {
        // Imports install ENABLED, so reserve a slot via the overflow-aware
        // allocator: it fills base addons first and spills into an overflow
        // folder (creating one + patching gameinfo) when base is full, instead
        // of failing once a >99 user has filled citadel/addons. Metadata is
        // keyed by the destination's metaKey (folder-prefixed for an overflow
        // slot). Copying before the next allocate marks the slot taken, so a
        // multi-VPK archive lands in distinct slots.
        for (let i = 0; i < sourceVpks.length; i++) {
            const destPath = await allocateEnabledVpkPath(deadlockPath);
            const destMetaKey = metaKeyFor(destPath);

            await copyIntoModSlot(sourceVpks[i].path, destPath, true);

            // Scrub any orphan metadata at this slot before writing.
            // setModMetadata merges into the existing entry, so stale fields
            // (gameBananaId, categoryName, etc.) from a prior occupant would
            // otherwise stick to the new local mod and visually merge it with
            // unrelated mods.
            removeModMetadata(destMetaKey);
            // Grouped members all carry the SAME name (the card title comes from
            // the group's primary) and are told apart by their variant label
            // instead of the old "(N)" suffix.
            const stampedName = trimmedName;
            const sourceFileName = localSourceFileStem(sourceVpks[i].fileName);
            await setModMetadataWithHash(destMetaKey, {
                modName: stampedName,
                thumbnailUrl: thumbnailDataUrl,
                nsfw: !!nsfw,
                sourceFileName,
                localGroupId,
                variantLabel:
                    localGroupId && sourceFileName ? prettifyLocalVariant(sourceFileName) : undefined,
            }, destPath);

            // ADOPTION: the just-copied VPK may already carry a Grimoire
            // imprint (the user re-imported an already-imprinted file, or
            // extracted one from an archive). Fill in whatever the embed
            // knows that the freshly-stamped sidecar above doesn't -
            // gamebananaId/author/category/etc. - so a later bulk imprint
            // classifies against a sidecar that already agrees with the
            // embed instead of one that looks impoverished by comparison
            // (the live bug this build fixes: without this, the next bulk
            // run would re-imprint FROM the impoverished sidecar and wipe
            // the embed's real identity). The user-typed name always wins
            // (setModMetadataWithHash already wrote it above; adoption's
            // own modName fill-in only fires when the sidecar has none,
            // which never happens here since stampedName is always set).
            const adoptionPatch = computeAdoptionPatchAt(destPath, getModMetadata(destMetaKey));
            if (hasAdoptionFields(adoptionPatch)) {
                setModMetadata(destMetaKey, adoptionPatch);
            }

            // Stamp imprinted/imprintStale from the embed truth immediately,
            // so the toolbar button's pending count is honest without
            // waiting for a restart (backfillImprintedFlags would otherwise
            // be the only thing to notice). Classify AFTER adoption so a
            // richer embed that adoption just caught the sidecar up to
            // reads fresh, not stale. hasAnyImprint (not
            // readAdoptionEmbedFields) is the right "is this file imprinted
            // at all" check: it also counts a re-imported merge embed,
            // which adoption itself deliberately never reads fields from.
            const finalMeta = getModMetadata(destMetaKey);
            if (hasAnyImprint(destPath)) {
                setModMetadata(destMetaKey, {
                    imprinted: true,
                    imprintStale: classifyEmbedFreshnessAt(destPath, stampedName, finalMeta) === 'stale',
                });
            }

            // THUMBNAIL FETCH: adoption may have just learned a gamebananaId
            // for a mod whose sidecar has no thumbnail (a local import of an
            // already-imprinted file never had a chance to fetch one). Queue
            // it; the actual network fetch runs after this handler returns
            // (best-effort, never blocks or fails the import).
            const adoptedGbId = finalMeta?.gameBananaId;
            if (adoptedGbId && !finalMeta?.thumbnailUrl) {
                thumbnailFetchTargets.push({
                    metaKey: destMetaKey,
                    gameBananaId: adoptedGbId,
                    section: finalMeta?.sourceSection || 'Mod',
                    // The hash setModMetadataWithHash just stamped: pins the
                    // fetch to THIS file, so a recycled slot is never stamped.
                    expectedSha256: finalMeta?.sha256,
                });
            }
        }
    } finally {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    return sourceVpks.length;
}

/**
 * Fire the adopted-thumbnail fetches a just-finished import queued up.
 * Fire-and-forget: never awaited, so a network failure can't affect the import
 * result already being returned to the renderer. Each fetch re-verifies slot
 * identity before writing (see services/adoptedThumbnail.ts).
 */
function fireAdoptedThumbnailFetches(targets: AdoptedThumbnailTarget[]): void {
    for (const target of targets) {
        void fetchAdoptedThumbnail(target);
    }
}

// import-custom-mods - batch local import.
//
// LOCK SCOPE: each source takes the exclusive mod mutation on its own, NOT the
// batch as a whole. Atomicity is only needed across allocate -> copy, which is
// one source's worth of work: if a Locker toggle claims a slot between two
// sources, the next allocateEnabledVpkPath simply scans and picks another free
// one. Holding the queue for the whole batch would buy nothing but contiguous
// pak numbering (cosmetic) while blocking every other mod mutation in the app
// (toggle, reorder, delete, profile apply, merge, imprint) for the minutes a
// 30-archive batch can take.
//
// Per-source failures are collected, never thrown: one corrupt archive (or
// hitting the 99-active cap partway) must not discard the sources that already
// landed, and the renderer needs to know which rows survived. Progress is
// streamed to the requesting renderer via 'import-custom-mods-progress' so long
// copies aren't a frozen dialog.
ipcMain.handle(
    'import-custom-mods',
    async (event, args: ImportCustomModsBatchArgs): Promise<ImportCustomModsBatchResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const items = args?.items ?? [];
        if (items.length === 0) {
            // Do NOT end this message with the bare word "import": electron-vite's
            // CJS-shim plugin scans the bundled chunk with an ESM-import regex, and
            // `import"` (word + closing quote) makes it match on through to the next
            // quote, splicing the shim into whatever string literal follows.
            throw new Error('No files were selected');
        }

        const thumbnailFetchTargets: AdoptedThumbnailTarget[] = [];
        const results: ImportCustomModResult[] = [];
        const total = items.length;
        const report = (progress: ImportCustomModsProgress): void => {
            if (!event.sender.isDestroyed()) event.sender.send('import-custom-mods-progress', progress);
        };

        for (let index = 0; index < total; index++) {
            const item = items[index];
            report({ index, total, vpkPath: item.vpkPath, phase: 'importing' });
            try {
                const imported = await runExclusiveModMutation(() =>
                    importCustomModSource(deadlockPath, item, thumbnailFetchTargets)
                );
                results.push({ vpkPath: item.vpkPath, ok: true, imported });
                report({ index, total, vpkPath: item.vpkPath, phase: 'done', imported });
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                results.push({ vpkPath: item.vpkPath, ok: false, imported: 0, error });
                console.warn(`[mods] Batch import failed for ${item.vpkPath}: ${error}`);
                report({ index, total, vpkPath: item.vpkPath, phase: 'failed', error });
            }
        }

        const mods = await scanMods(deadlockPath);
        const result = mods.map(enrichMod);
        fireAdoptedThumbnailFetches(thumbnailFetchTargets);
        return { mods: result, results };
    }
);

// foundry:swapSound
// Build a hero sound-swap addon VPK (drop your own MP3 onto a hero gameplay
// sound event) and install it as a tracked local mod, mirroring
// import-soul-container-glb's build -> allocate -> copy -> metadata flow. Event
// mode with --pool all: every clip in the event's randomizer pool is overridden
// with the user audio, so the swapped sound always plays. Tagged with lockerHero
// so it groups under the hero in the Locker. v1 takes MP3 only (the mint path
// parses the rate/channels from MP3 frame headers, no ffmpeg).
ipcMain.handle(
    'foundry:swapSound',
    async (_, args: HeroSoundSwapRequest): Promise<WireMod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const {
            heroCodename,
            heroName,
            event,
            clipPaths,
            audioPath,
            name,
            loop,
            thumbnailDataUrl,
            nsfw,
            trimStartMs,
            trimEndMs,
            gainDb,
        } = args;
        const hasClips = Array.isArray(clipPaths) && clipPaths.length > 0;
        if (!name?.trim()) {
            throw new Error('A name is required');
        }
        if (!event?.trim() && !hasClips) {
            throw new Error('A sound event or clip is required');
        }
        if (!audioPath || !existsSync(audioPath)) {
            throw new Error('Audio file not found');
        }
        if (!audioPath.toLowerCase().endsWith('.mp3')) {
            throw new Error('Audio must be an MP3 file (other formats are not supported yet).');
        }

        // 1. Build the swap VPK to a temp staging path. Gameplay rows pass an
        //    event (event mode); voice lines pass clipPaths (clip mode), which
        //    win when both are present.
        const built = await buildHeroSoundSwapVpk(deadlockPath, {
            heroCodename,
            event: event?.trim(),
            clipPaths: hasClips ? clipPaths : undefined,
            audioPath,
            loop: loop ?? 'auto',
            trimStartMs,
            trimEndMs,
            gainDb,
        });

        try {
            // 2. Allocate the next free ENABLED slot (same as import-custom-mod).
            const destPath = await allocateEnabledVpkPath(deadlockPath);
            const destMetaKey = metaKeyFor(destPath);

            await copyIntoModSlot(built.vpkPath, destPath, true);

            const soundSwap: SoundSwapInfo = {
                heroCodename: built.soundCodename,
                event: event?.trim() || clipPaths?.[0] || '',
                audioFileName: basename(audioPath),
                loop: loop ?? 'auto',
                pool: 'all',
            };

            // 3. Scrub orphan metadata, then write the local-import entry. Tag it
            //    with lockerHero (display name) so it groups under the hero in the
            //    Locker; sourceSection marks it a Foundry sound swap.
            removeModMetadata(destMetaKey);
            await setModMetadataWithHash(
                destMetaKey,
                {
                    modName: name.trim(),
                    thumbnailUrl: thumbnailDataUrl,
                    nsfw: !!nsfw,
                    // 'Sound' routes the mod through the Locker's Sounds bucket
                    // (isLockerManagedSound) instead of the hero-skin pile
                    // (isLockerManagedMod treats any non-'Sound' + lockerHero mod
                    // as a skin card). The lockerHero tag makes it hero-specific,
                    // which short-circuits the global-sound-category drop. The
                    // Foundry-swap provenance lives in `soundSwap`, not the section.
                    sourceSection: 'Sound',
                    categoryName: 'Sounds',
                    ...(heroName?.trim()
                        ? { lockerHero: heroName.trim(), lockerHeroSource: 'manual' as LockerHeroSource }
                        : {}),
                    soundSwap,
                },
                destPath
            );

            const mods = await scanMods(deadlockPath);
            return mods.map(enrichMod);
        } finally {
            // 4. Always remove the temp staging dir (the installed copy is
            //    byte-identical, so nothing is lost).
            await cleanupHeroSoundSwapBuild(built.vpkPath);
        }
    }
);

// preview-soul-container-glb
// Build the override VPK for the current orientation and export its model back
// to a GLB so the import modal can render EXACTLY what will load in-game (the
// preview can't drift from the build). Temp artifacts are cleaned up by the
// service. Geometry depends only on orient/rotate, so the modal calls this
// (debounced) on orientation changes, not on every keystroke.
ipcMain.handle(
    'preview-soul-container-glb',
    async (_, args: PreviewSoulContainerGlbArgs): Promise<SoulContainerPreview> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const preview = await previewSoulContainerGlb(deadlockPath, {
            glbPath: args.glbPath,
            name: 'preview',
            orient: args.orient,
            rotate: args.rotate,
            yaw: args.yaw,
            upright: args.upright,
            glow: args.glow,
        });
        return {
            glbBase64: preview.glbBase64,
            orient: preview.orient,
            fitScale: preview.report.fitScale,
            sourceSpan: preview.report.sourceSpan,
            targetSpan: preview.report.targetSpan,
        };
    }
);

// import-soul-container-glb
// Build a soul-container override VPK from a user GLB (bundled `vpkmerge
// soul-container import`) and install it as a tracked local mod, mirroring
// import-custom-mod's allocate -> copy -> metadata flow. Soul-container imports
// all override the same canonical model path, so two enabled at once would
// fight: when `replaceMetaKey` is given we reuse that slot in place instead of
// allocating a new one (the UI offers this when another import is already
// enabled).
ipcMain.handle(
    'import-soul-container-glb',
    async (_, args: ImportSoulContainerGlbArgs): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const { glbPath, name, orient, rotate, yaw, upright, glow, status, notes, nsfw, thumbnailDataUrl, replaceMetaKey } = args;
        if (!name?.trim()) {
            throw new Error('A name is required');
        }

        // 1. Build the override VPK to a temp staging path.
        const built = await buildSoulContainerVpk(deadlockPath, {
            glbPath,
            name: name.trim(),
            orient,
            rotate,
            yaw,
            upright,
            glow,
        });

        try {
            // 2. Resolve the destination slot: reuse the previous import's slot
            //    when replacing (never stack two soul containers), else allocate
            //    the next free ENABLED slot the same way import-custom-mod does.
            let destPath: string | null = null;
            let destMetaKey: string | null = null;
            if (replaceMetaKey) {
                destPath = await resolveModVpk(deadlockPath, replaceMetaKey);
                if (destPath) destMetaKey = replaceMetaKey;
            }
            let freshSlot = false;
            if (!destPath) {
                destPath = await allocateEnabledVpkPath(deadlockPath);
                destMetaKey = metaKeyFor(destPath);
                freshSlot = true;
            }

            // Captured before the copy replaces it: a REUSED slot keeps its
            // fileName and metaKey but gets new bytes, so saved profile entries
            // have to be moved onto the new hash below. A fresh slot is skipped
            // deliberately: any sidecar entry still sitting there is an orphan
            // of a deleted mod, and retargeting it would hand this import that
            // dead mod's profile entries.
            const previousSha = freshSlot ? undefined : getModMetadata(destMetaKey!)?.sha256;

            await copyIntoModSlot(built.vpkPath, destPath, freshSlot);
            // A reused slot may have a stale exported-GLB cache; drop it so the
            // Locker tile re-exports the new model.
            await clearSoulModelCache(destMetaKey!);

            const soulImport: SoulContainerImportInfo = {
                glbFileName: basename(glbPath),
                orient,
                glow,
                ...(rotate && (rotate[0] || rotate[1] || rotate[2]) ? { rotate } : {}),
                ...(yaw ? { yaw } : {}),
                ...(upright === false ? { upright } : {}),
                vpkmergeVersion: built.report.version,
                fitScale: built.report.fitScale,
                sourceSpan: built.report.sourceSpan,
                targetSpan: built.report.targetSpan,
                status: status ?? 'untested',
            };

            // 3. Scrub orphan metadata, then write the local-import entry. We set
            //    globalType explicitly (it always classifies as soul-container) so
            //    it lands in the Locker's Global soul-container group immediately.
            removeModMetadata(destMetaKey!);
            await setModMetadataWithHash(
                destMetaKey!,
                {
                    modName: name.trim(),
                    thumbnailUrl: thumbnailDataUrl,
                    nsfw: !!nsfw,
                    sourceSection: 'SoulContainerImport',
                    globalType: 'soul-container',
                    globalTypeClassifierVersion: GLOBAL_CLASSIFIER_VERSION,
                    soulImport,
                    ...(notes?.trim() ? { variantLabel: notes.trim() } : {}),
                },
                destPath
            );
            retargetProfileModSha(previousSha, getModMetadata(destMetaKey!)?.sha256);

            const mods = await scanMods(deadlockPath);
            return mods.map(enrichMod);
        } finally {
            // 4. Always remove the temp staging dir (the installed copy is
            //    byte-identical, so nothing is lost).
            await cleanupSoulContainerBuild(built.vpkPath);
        }
    }
);

// export-soul-container-glb
// Build the same soul-container override VPK import-soul-container-glb builds, but
// save it to disk via a native dialog instead of installing it into the mod list
// (the export half of the Foundry output layer). Returns { exported: false } if
// the user cancels the save dialog.
ipcMain.handle(
    'export-soul-container-glb',
    async (_, args: ImportSoulContainerGlbArgs): Promise<VpkExportResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const { glbPath, name, orient, rotate, yaw, upright, glow } = args;
        if (!name?.trim()) {
            throw new Error('A name is required');
        }

        const built = await buildSoulContainerVpk(deadlockPath, {
            glbPath,
            name: name.trim(),
            orient,
            rotate,
            yaw,
            upright,
            glow,
        });
        try {
            return await exportVpkViaDialog(built.vpkPath, exportVpkFileName(name));
        } finally {
            await cleanupSoulContainerBuild(built.vpkPath);
        }
    }
);

// preview-spirit-urn-glb
// Build the urn override VPK for the current orientation/span and export its
// model back to a GLB so the import modal renders EXACTLY what loads in-game.
// Mirrors preview-soul-container-glb.
ipcMain.handle(
    'preview-spirit-urn-glb',
    async (_, args: PreviewSpiritUrnGlbArgs): Promise<SpiritUrnPreview> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const preview = await previewSpiritUrnGlb(deadlockPath, {
            glbPath: args.glbPath,
            name: 'preview',
            orient: args.orient,
            rotate: args.rotate,
            ground: args.ground,
            span: args.span,
        });
        return {
            glbBase64: preview.glbBase64,
            orient: preview.orient,
            fitScale: preview.report.fitScale,
            sourceSpan: preview.report.sourceSpan,
            targetSpan: preview.report.targetSpan,
        };
    }
);

// import-spirit-urn-glb
// Build a Spirit Urn override VPK from a user GLB (bundled `vpkmerge
// soul-container import-urn`) and install it as a tracked local mod, mirroring
// import-soul-container-glb. Urn imports all override the same model path
// (idol_urn.vmdl_c), so two enabled at once would fight: when `replaceMetaKey`
// is given we reuse that slot in place instead of allocating a new one.
ipcMain.handle(
    'import-spirit-urn-glb',
    async (_, args: ImportSpiritUrnGlbArgs): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const { glbPath, name, orient, rotate, ground, span, status, notes, nsfw, thumbnailDataUrl, replaceMetaKey } = args;
        if (!name?.trim()) {
            throw new Error('A name is required');
        }

        // 1. Build the override VPK to a temp staging path.
        const built = await buildSpiritUrnVpk(deadlockPath, {
            glbPath,
            name: name.trim(),
            orient,
            rotate,
            ground,
            span,
        });

        try {
            // 2. Resolve the destination slot: reuse the previous import's slot
            //    when replacing (never stack two urns), else allocate the next
            //    free ENABLED slot the same way import-soul-container-glb does.
            let destPath: string | null = null;
            let destMetaKey: string | null = null;
            if (replaceMetaKey) {
                destPath = await resolveModVpk(deadlockPath, replaceMetaKey);
                if (destPath) destMetaKey = replaceMetaKey;
            }
            let freshSlot = false;
            if (!destPath) {
                destPath = await allocateEnabledVpkPath(deadlockPath);
                destMetaKey = metaKeyFor(destPath);
                freshSlot = true;
            }

            // Same capture as import-soul-container-glb: a reused slot keeps
            // its fileName and metaKey but gets new bytes, a fresh one carries
            // only orphan metadata worth ignoring.
            const previousSha = freshSlot ? undefined : getModMetadata(destMetaKey!)?.sha256;

            await copyIntoModSlot(built.vpkPath, destPath, freshSlot);
            // A reused slot may have a stale exported-GLB cache; drop it so the
            // Locker tile re-exports the new model.
            await clearSoulModelCache(destMetaKey!);

            const urnImport: UrnImportInfo = {
                glbFileName: basename(glbPath),
                orient,
                ...(rotate && (rotate[0] || rotate[1] || rotate[2]) ? { rotate } : {}),
                ...(ground ? { ground } : {}),
                span,
                vpkmergeVersion: built.report.version,
                fitScale: built.report.fitScale,
                sourceSpan: built.report.sourceSpan,
                targetSpan: built.report.targetSpan,
                status: status ?? 'untested',
            };

            // 3. Scrub orphan metadata, then write the local-import entry. We set
            //    globalType explicitly (always 'spirit-urn') so it lands in the
            //    Locker's Global spirit-urn group immediately.
            removeModMetadata(destMetaKey!);
            await setModMetadataWithHash(
                destMetaKey!,
                {
                    modName: name.trim(),
                    thumbnailUrl: thumbnailDataUrl,
                    nsfw: !!nsfw,
                    sourceSection: 'SpiritUrnImport',
                    globalType: 'spirit-urn',
                    globalTypeClassifierVersion: GLOBAL_CLASSIFIER_VERSION,
                    urnImport,
                    ...(notes?.trim() ? { variantLabel: notes.trim() } : {}),
                },
                destPath
            );
            retargetProfileModSha(previousSha, getModMetadata(destMetaKey!)?.sha256);

            const mods = await scanMods(deadlockPath);
            return mods.map(enrichMod);
        } finally {
            // 4. Always remove the temp staging dir (the installed copy is
            //    byte-identical, so nothing is lost).
            await cleanupSpiritUrnBuild(built.vpkPath);
        }
    }
);

// export-spirit-urn-glb
// Disk-export counterpart of import-spirit-urn-glb: build the same urn override
// VPK, then save it to disk via a native dialog instead of installing it.
ipcMain.handle(
    'export-spirit-urn-glb',
    async (_, args: ImportSpiritUrnGlbArgs): Promise<VpkExportResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const { glbPath, name, orient, rotate, ground, span } = args;
        if (!name?.trim()) {
            throw new Error('A name is required');
        }

        const built = await buildSpiritUrnVpk(deadlockPath, {
            glbPath,
            name: name.trim(),
            orient,
            rotate,
            ground,
            span,
        });
        try {
            return await exportVpkViaDialog(built.vpkPath, exportVpkFileName(name));
        } finally {
            await cleanupSpiritUrnBuild(built.vpkPath);
        }
    }
);

// merge-mods — combine multiple installed VPKs into one via vpkmerge. Sources
// are disabled (moved to .disabled/) so their priority slots free up; the
// merged mod takes the next available pakNN slot. Manifest (source list +
// portable-profile share code) is stored in the merged mod's metadata so
// unmerge can either re-enable the originals or fall back to the share code.
ipcMain.handle('merge-mods', async (_, args: MergeModsArgs): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const result = await mergeMods(deadlockPath, args.modIds, {
        name: args.name,
        thumbnailDataUrl: args.thumbnailDataUrl,
        strict: args.strict,
    });
    return enrichMod(result.mod);
});

// unmerge-mod — reverse a merge by re-enabling sources still on disk and
// deleting the merged VPK. Returns missing-source filenames + the share code
// so the renderer can offer the portable-profile import flow for recovery.
ipcMain.handle(
    'unmerge-mod',
    async (_, mergedModId: string): Promise<UnmergeModResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const result = await unmergeMod(deadlockPath, mergedModId);
        return {
            ...result,
            recovered: result.recovered.map(enrichMod),
        };
    }
);

// extract-merge-source — pull one source out of a merged VPK and restore it as
// a standalone mod. The remaining sources are re-merged in place (or the merge
// dissolves when fewer than two would remain).
ipcMain.handle(
    'extract-merge-source',
    async (
        _,
        mergedModId: string,
        sourceFileName: string
    ): Promise<ExtractMergeSourceResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const result = await extractMergeSource(deadlockPath, mergedModId, sourceFileName);
        return {
            ...result,
            merged: result.merged ? enrichMod(result.merged) : null,
            restored: result.restored.map(enrichMod),
        };
    }
);

// add-merge-sources - rebuild an existing merged VPK in its current slot with
// additional standalone source mods. Strict failures leave the original merge
// untouched because the service builds and embeds to a dotfile before swap.
ipcMain.handle(
    'add-merge-sources',
    async (
        _,
        mergedModId: string,
        addModIds: string[],
        strict = false
    ): Promise<AddMergeSourcesResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        return addMergeSources(deadlockPath, mergedModId, addModIds, { strict });
    }
);

// replace-merge-sources - swap absorbed sources for freshly downloaded
// replacements and rebuild the merge in its current slot. Each replacement
// inherits the retired source's merge-time priority, so collision order
// survives. Old source VPKs are deleted only after the swap lands.
ipcMain.handle(
    'replace-merge-sources',
    async (
        _,
        mergedModId: string,
        replacements: MergeSourceReplacement[],
        strict = false
    ): Promise<ReplaceMergeSourcesResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        return replaceMergeSources(deadlockPath, mergedModId, replacements, { strict });
    }
);

// imprint-one-mod: re-pack a single installed VPK in place with a self-identifying
// addoninfo.txt embed (path B). Refuses if the running game has the mod loaded.
// Canonical identity (metadata.sha256) is unchanged; the embed carries it.
ipcMain.handle('imprint-one-mod', async (_, modId: string): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const imprinted = await imprintOneMod(deadlockPath, modId);
    return enrichMod(imprinted);
});

// imprint-all-installed: retroactively imprint the whole installed library in place.
// Loaded mods are skipped and reported; per-mod failures are collected. Streams
// progress to the requesting renderer via 'imprint-all-installed-progress'.
ipcMain.handle('imprint-all-installed', async (event) => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    return imprintAllInstalled(deadlockPath, (progress) =>
        event.sender.send('imprint-all-installed-progress', progress)
    );
});

// imprint-preflight: no-network dry-run that classifies every installed mod into
// imprint buckets (eligible / already-imprinted / blocked-loaded / merged /
// locker-managed / anomalous) WITHOUT mutating any file. Drives the pre-commit
// confirmation UI. Never re-records any canonical identity (KEYSTONE).
ipcMain.handle('imprint-preflight', async (): Promise<ImprintPreflightResult> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    return imprintPreflight(deadlockPath);
});

// read-imprint-details: read back the FULL embedded imprint of one installed VPK
// for the "View imprint" modal. Strictly read-only: reuses the existing embed
// readers (readEmbeddedAddonInfoText/parseAddonInfo + readEmbeddedModinfo),
// takes no lock, writes no metadata, mutates no file. Returns null (not an
// error) when the file carries no addoninfo.txt or a foreign embed without a
// recoverable original identity, so a stale `imprinted` flag degrades to the
// modal's empty state. A legacy (pre-redo) imprint returns its carried
// identity + addoninfo fields with modinfo: null. fs/scan errors propagate as
// normal IPC errors.
ipcMain.handle('read-imprint-details', async (_, modId: string): Promise<ImprintDetails | null> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mods = await scanMods(deadlockPath);
    const mod = mods.find((m) => m.id === modId);
    if (!mod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    // One entry read serves both the raw view and the parsed projection.
    const rawAddonInfo = readEmbeddedAddonInfoText(mod.path);
    if (rawAddonInfo === null) return null;
    const embedded = parseAddonInfo(rawAddonInfo);
    // Reuse the embed-validity rule (a recoverable original sha256, current
    // keys or legacy shim, is what makes an embed a Grimoire imprint); a
    // foreign embed reads as "none".
    const original = carryForwardOriginalIdentity(embedded, readLegacyGrimoireMergeMeta(mod.path));
    if (!original) return null;

    return {
        title: embedded.title,
        author: embedded.author,
        gamebananaId: embedded.gamebananaId,
        gamebananaFileId: embedded.gamebananaFileId,
        sourceUrl: embedded.sourceUrl,
        buildDate: embedded.buildDate,
        originalSha256: original.sha256,
        originalCrc32: original.crc32,
        originalSize: original.size,
        rawAddonInfo,
        modinfo: readEmbeddedModinfo(mod.path),
    };
});

// peek-imprint: read-only recognition check for the import dialog. Takes an
// absolute file path directly (the user's picked source .vpk, BEFORE it is
// copied/imported anywhere), not a modId - there is no installed Mod yet at
// this point. No lock, no writes, no scanMods: same read-only contract as
// read-imprint-details, just against an arbitrary path instead of an
// installed slot. Returns null when the path isn't a readable .vpk or carries
// no recoverable Grimoire embed, so the dialog's recognition note simply
// doesn't show rather than erroring.
ipcMain.handle('peek-imprint', async (_, filePath: string): Promise<PeekImprintResult | null> => {
    if (!filePath || !filePath.toLowerCase().endsWith('.vpk') || !existsSync(filePath)) {
        return null;
    }

    const modinfo = readEmbeddedModinfo(filePath);
    if (modinfo) {
        if (modinfo.kind === 'merge') {
            return { title: modinfo.merge.title || modinfo.title, kind: 'merge' };
        }
        return {
            title: modinfo.title,
            author: modinfo.author,
            gamebananaId: modinfo.source?.gamebananaId,
            gamebananaFileId: modinfo.source?.gamebananaFileId,
            kind: 'mod',
        };
    }

    // No current-format record: fall back to the legacy addoninfo.txt keys
    // (mirrors read-imprint-details' embed-validity rule).
    const embedded = readEmbeddedAddonInfo(filePath);
    if (!embedded) return null;
    const original = carryForwardOriginalIdentity(embedded, readLegacyGrimoireMergeMeta(filePath));
    if (!original) return null;

    const legacyGbId = embedded.gamebananaId ? Number(embedded.gamebananaId) : undefined;
    const legacyFileId = embedded.gamebananaFileId ? Number(embedded.gamebananaFileId) : undefined;
    return {
        title: embedded.title,
        author: embedded.author,
        gamebananaId: legacyGbId !== undefined && Number.isFinite(legacyGbId) ? legacyGbId : undefined,
        gamebananaFileId:
            legacyFileId !== undefined && Number.isFinite(legacyFileId) ? legacyFileId : undefined,
        // A legacy merge companion is the only way a legacy embed could be a
        // merge; readLegacyGrimoireMergeMeta's presence with a readable source
        // list is the same signal classifyMissingMergeManifest uses elsewhere.
        kind: hasLegacyGrimoireMergeMetaEntry(filePath) ? 'merge' : 'mod',
    };
});
