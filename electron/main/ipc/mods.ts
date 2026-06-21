import { ipcMain, shell } from 'electron';
import { promises as fs, existsSync } from 'fs';
import { extname, basename, join, resolve, sep } from 'path';
import { loadSettings, saveSettings, getActiveDeadlockPath } from '../services/settings';
import {
    scanMods,
    enableMod,
    disableMod,
    deleteMod,
    setModPriority,
    reorderMods,
    swapModPriority,
    allocateEnabledVpkPath,
    type Mod,
} from '../services/mods';
import { metaKeyFor } from '../services/deadlock';
import { getModMetadata, setModMetadata, setModMetadataWithHash, removeModMetadata, pruneOrphanMetadata } from '../services/metadata';
import { inferHeroFromTitle } from '@grimoire/social-types/heroes';
import { inferHeroFromVpk, classifyGlobalModFromVpk, GLOBAL_CLASSIFIER_VERSION, parseVpkDirectory, parseVpkDirectoriesAsync } from '../services/vpk';
import { classifyAbilitySoundsFromVpk } from '../services/abilitySounds';
import { migrateIgnoredConflictKeysForMods } from '../services/conflicts';
import { isLockerManaged } from '../services/lockerVpk';
import {
    detectUnknownModCacheMatches,
    detectUnknownModFilters,
    emptyCrcMatch,
    inferHeroFromVpkTree,
    type UnknownModCacheMatchInput,
    type UnknownModFilterGuess,
} from '../services/unknownModDetection';
import { downloadMod } from '../services/download';
import { mergeMods, unmergeMod, extractMergeSource } from '../services/modMerger';
import { buildSoulContainerVpk, cleanupSoulContainerBuild, previewSoulContainerGlb } from '../services/soulContainerImport';
import { buildSpiritUrnVpk, cleanupSpiritUrnBuild, previewSpiritUrnGlb } from '../services/spiritUrnImport';
import { resolveModVpk, clearSoulModelCache } from '../services/soulContainerModels';
import { getMainWindow } from '../index';
import type { ImportCustomModArgs, ImportSoulContainerGlbArgs, PreviewSoulContainerGlbArgs, SoulContainerPreview, ImportSpiritUrnGlbArgs, PreviewSpiritUrnGlbArgs, SpiritUrnPreview } from '../../../src/types/electron';
import type { AbilitySoundClassification, ApplyUnknownCustomModArgs, ApplyUnknownModMatchArgs, AssociateUnknownModArgs, EditLocalModArgs, GlobalModType, LockerHeroSource, MergeModsArgs, Mod as WireMod, SoulContainerImportInfo, UrnImportInfo, UnmergeModResult, ExtractMergeSourceResult, UnknownModFileList } from '../../../src/types/mod';

const unknownDetectionControllers = new Map<string, AbortController>();

interface UnknownCacheBulkRequest {
    modId: string;
    requestId?: string;
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
            let inferred = inferHeroFromTitle(metadata.modName || mod.name);
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
            lockerHero,
            lockerHeroSource,
            globalType: globalType ?? undefined,
            merged: metadata.merged,
            lockerCosmetics: metadata.lockerCosmetics,
            lockerSounds: metadata.lockerSounds,
            abilitySounds: abilitySounds ?? undefined,
            soulImport: metadata.soulImport,
            urnImport: metadata.urnImport,
            ignoreUpdates: metadata.ignoreUpdates,
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
    if (!settings.devMode) {
        // Prune against ALL scanned files (including managed VPKs) so we don't
        // wipe their metadata before filtering them out of the list below.
        pruneOrphanMetadata(new Set(mods.map((m) => m.metaKey)));
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
    return visible.map(enrichMod);
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

// import-custom-mod
// The Deadlock engine requires strict `pakXX_dir.vpk` naming (see apply-mina-variant),
// so custom imports always get a naked `pakNN_dir.vpk` filename - no slug. The
// human-readable name lives in metadata.modName and is shown in the UI instead.
ipcMain.handle(
    'import-custom-mod',
    async (_, args: ImportCustomModArgs): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }

        const { vpkPath, name, thumbnailDataUrl, nsfw } = args;

        if (!vpkPath || !existsSync(vpkPath)) {
            throw new Error('VPK file not found');
        }
        if (!vpkPath.toLowerCase().endsWith('.vpk')) {
            throw new Error('Selected file is not a .vpk');
        }
        if (!name?.trim()) {
            throw new Error('A name is required');
        }

        // Imports install ENABLED, so reserve a slot via the overflow-aware
        // allocator: it fills base addons first and spills into an overflow
        // folder (creating one + patching gameinfo) when base is full, instead of
        // failing once a >99 user has filled citadel/addons. Metadata is keyed by
        // the destination's metaKey (folder-prefixed for an overflow slot).
        const destPath = await allocateEnabledVpkPath(deadlockPath);
        const destMetaKey = metaKeyFor(destPath);

        await fs.copyFile(vpkPath, destPath);

        // Scrub any orphan metadata at this slot before writing. setModMetadata
        // merges into the existing entry, so stale fields (gameBananaId,
        // categoryName, etc.) from a prior occupant would otherwise stick to
        // the new local mod and visually merge it with unrelated mods.
        removeModMetadata(destMetaKey);
        await setModMetadataWithHash(destMetaKey, {
            modName: name.trim(),
            thumbnailUrl: thumbnailDataUrl,
            nsfw: !!nsfw,
        }, destPath);

        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
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
            if (!destPath) {
                destPath = await allocateEnabledVpkPath(deadlockPath);
                destMetaKey = metaKeyFor(destPath);
            }

            await fs.copyFile(built.vpkPath, destPath);
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

            const mods = await scanMods(deadlockPath);
            return mods.map(enrichMod);
        } finally {
            // 4. Always remove the temp staging dir (the installed copy is
            //    byte-identical, so nothing is lost).
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
            if (!destPath) {
                destPath = await allocateEnabledVpkPath(deadlockPath);
                destMetaKey = metaKeyFor(destPath);
            }

            await fs.copyFile(built.vpkPath, destPath);
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

            const mods = await scanMods(deadlockPath);
            return mods.map(enrichMod);
        } finally {
            // 4. Always remove the temp staging dir (the installed copy is
            //    byte-identical, so nothing is lost).
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
