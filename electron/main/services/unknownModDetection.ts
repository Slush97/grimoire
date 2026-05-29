import { promises as fs } from 'fs';
import { crc32File, fetchGameBananaArchiveVpkCrcEntries } from './archiveCrc';
import {
    fetchModsFilesMetadata,
    fetchSubmissions,
    type GameBananaFileMetadataResult,
    type GameBananaMod,
    type GameBananaModsResponse,
} from './gamebanana';
import { parseVpkDirectory } from './vpk';
import { fingerprintFilesInWorkers, type FileFingerprintResult } from './workers';
import {
    getUnknownCrcEntryCount,
    getUnknownCrcFilesForMods,
    lookupUnknownCrcMatch,
    lookupUnknownCrcMatches,
    replaceUnknownCrcEntries,
    updateUnknownCrcFileStatus,
    upsertUnknownCrcFiles,
    UNKNOWN_CRC_PARSER_VERSION,
    type UnknownCrcFile,
    type UnknownCrcFileInput,
    type UnknownCrcLookupMatch,
} from './unknownCrcCache';
import type {
    UnknownModCrcMatchResult,
    UnknownModDetectionProgress,
    UnknownModFilterGuess,
} from '../../../src/types/mod';

export type { UnknownModFilterGuess };

export interface UnknownModDetectionOptions {
    signal?: AbortSignal;
    requestId?: string;
    onProgress?: (progress: UnknownModDetectionProgress) => void;
}

export interface UnknownModCacheMatchInput {
    modId: string;
    fileName: string;
    vpkPath: string;
    requestId?: string;
}

interface LocalVpkFingerprint {
    size: number;
    crc32: string;
}

interface SearchBucket {
    section: 'Mod' | 'Sound';
    categoryId?: number;
    categoryName?: string;
    search?: string;
    label: string;
}

interface HeroHint {
    code: string;
    display: string;
    skinCategoryId: number;
}

interface CategoryTarget {
    section: 'Mod' | 'Sound';
    categoryId?: number;
    categoryName: string;
}

const CANDIDATE_PAGE_SIZE = 50;
const LOCAL_FINGERPRINT_CACHE_MAX = 128;
const CACHE_FINGERPRINT_CONCURRENCY = 8;
const CATEGORIES = {
    skins: 33295,
    modelReplacement: 33154,
    hud: 31713,
    maps: 37225,
    gameplay: 33331,
    modMisc: 31710,
} as const;

const CATEGORY_TARGETS = {
    skins: { section: 'Mod', categoryId: CATEGORIES.skins, categoryName: 'Skins' },
    modelReplacement: { section: 'Mod', categoryId: CATEGORIES.modelReplacement, categoryName: 'Model Replacement' },
    hud: { section: 'Mod', categoryId: CATEGORIES.hud, categoryName: 'HUD' },
    maps: { section: 'Mod', categoryId: CATEGORIES.maps, categoryName: 'Maps' },
    gameplay: { section: 'Mod', categoryId: CATEGORIES.gameplay, categoryName: 'Gameplay' },
    modMisc: { section: 'Mod', categoryId: CATEGORIES.modMisc, categoryName: 'Other/Misc' },
    soundMisc: { section: 'Sound', categoryName: 'Sounds' },
} as const satisfies Record<string, CategoryTarget>;

type CategoryKey = keyof typeof CATEGORY_TARGETS;

interface CategoryPathRule {
    pattern: RegExp;
    points: Partial<Record<CategoryKey, number>>;
}

const CATEGORY_TIE_BREAKERS: CategoryKey[] = [
    'skins',
    'modelReplacement',
    'hud',
    'soundMisc',
    'maps',
    'gameplay',
    'modMisc',
];

const CATEGORY_PATH_RULES: CategoryPathRule[] = [
    { pattern: /(?:^|\/)models\/heroes(?:_wip|_staging)?\//, points: { skins: 120, modelReplacement: 80 } },
    { pattern: /(?:^|\/)materials\/models\/heroes(?:_wip|_staging)?\//, points: { skins: 100, modelReplacement: 70 } },
    { pattern: /(?:^|\/)materials\/heroes(?:_wip|_staging)?\//, points: { skins: 80, modelReplacement: 50 } },
    { pattern: /(?:^|\/)animgraphs\/animgraph2\/hero\//, points: { skins: 60, modelReplacement: 40 } },
    { pattern: /(?:^|\/)models\//, points: { modelReplacement: 80, skins: 40 } },
    { pattern: /(?:^|\/)materials\/models\//, points: { modelReplacement: 60, skins: 30 } },
    { pattern: /(?:^|\/)particles\/abilities\//, points: { skins: 50, modelReplacement: 30 } },
    { pattern: /(?:^|\/)materials\/particle\/abilities\//, points: { skins: 40, modelReplacement: 25 } },
    { pattern: /(?:^|\/)particles\//, points: { modelReplacement: 25, modMisc: 15 } },
    { pattern: /(?:^|\/)panorama\/images\/heroes\//, points: { hud: 50, skins: 25 } },
    { pattern: /(?:^|\/)panorama\/images\/hud\/abilities\//, points: { hud: 60, skins: 25 } },
    { pattern: /(?:^|\/)panorama\//, points: { hud: 90, gameplay: 20 } },
    { pattern: /(?:^|\/)hud\//, points: { hud: 80 } },
    { pattern: /(?:^|\/)maps\//, points: { maps: 120 } },
    { pattern: /(?:^|\/)materials\/skybox\//, points: { maps: 100 } },
    { pattern: /(?:^|\/)postprocessing\/|\.vpost_c$/, points: { modMisc: 80, gameplay: 20 } },
    { pattern: /(?:^|\/)scripts\/tagged_sounds\//, points: { soundMisc: 80 } },
    { pattern: /(?:^|\/)soundevents\/hero\//, points: { soundMisc: 80 } },
    { pattern: /(?:^|\/)sounds?\//, points: { soundMisc: 80 } },
    { pattern: /(?:^|\/)scripts\//, points: { gameplay: 40, modMisc: 20 } },
    { pattern: /\.vjs_c$|\.vxml_c$|\.vcss_c$/, points: { hud: 30 } },
];
const MODEL_PATH_PATTERN = /(?:^|\/)(?:models\/|materials\/models\/|materials\/heroes(?:_wip|_staging)?\/|animgraphs\/animgraph2\/hero\/)/;

const FAILED_RETRY_SECONDS = 6 * 60 * 60;

const HERO_HINTS: HeroHint[] = [
    { display: 'Abrams', code: 'atlas', skinCategoryId: 33306 },
    { display: 'Apollo', code: 'fencer', skinCategoryId: 42673 },
    { display: 'Bebop', code: 'bebop', skinCategoryId: 33307 },
    { display: 'Billy', code: 'punkgoat', skinCategoryId: 41491 },
    { display: 'Calico', code: 'nano', skinCategoryId: 41649 },
    { display: 'Celeste', code: 'unicorn', skinCategoryId: 42672 },
    { display: 'Doorman', code: 'doorman', skinCategoryId: 40060 },
    { display: 'Drifter', code: 'drifter', skinCategoryId: 41492 },
    { display: 'Dynamo', code: 'dynamo', skinCategoryId: 33308 },
    { display: 'Graves', code: 'necro', skinCategoryId: 42674 },
    { display: 'Grey Talon', code: 'orion', skinCategoryId: 33310 },
    { display: 'Haze', code: 'haze', skinCategoryId: 33311 },
    { display: 'Holliday', code: 'astro', skinCategoryId: 36472 },
    { display: 'Infernus', code: 'inferno', skinCategoryId: 33312 },
    { display: 'Ivy', code: 'tengu', skinCategoryId: 33313 },
    { display: 'Kelvin', code: 'kelvin', skinCategoryId: 33314 },
    { display: 'Lady Geist', code: 'geist', skinCategoryId: 33315 },
    { display: 'Lash', code: 'lash', skinCategoryId: 33316 },
    { display: 'McGinnis', code: 'forge', skinCategoryId: 33317 },
    { display: 'Mina', code: 'vampirebat', skinCategoryId: 41313 },
    { display: 'Mirage', code: 'mirage', skinCategoryId: 33318 },
    { display: 'Mo & Krill', code: 'krill', skinCategoryId: 33319 },
    { display: 'Paige', code: 'bookworm', skinCategoryId: 39672 },
    { display: 'Paradox', code: 'chrono', skinCategoryId: 33320 },
    { display: 'Pocket', code: 'synth', skinCategoryId: 33321 },
    { display: 'Rem', code: 'familiar', skinCategoryId: 42675 },
    { display: 'Seven', code: 'gigawatt', skinCategoryId: 33322 },
    { display: 'Shiv', code: 'shiv', skinCategoryId: 33323 },
    { display: 'Silver', code: 'werewolf', skinCategoryId: 42671 },
    { display: 'Sinclair', code: 'magician', skinCategoryId: 36529 },
    { display: 'Venator', code: 'priest', skinCategoryId: 42676 },
    { display: 'Victor', code: 'frank', skinCategoryId: 39980 },
    { display: 'Vindicta', code: 'hornet', skinCategoryId: 33324 },
    { display: 'Viscous', code: 'viscous', skinCategoryId: 33325 },
    { display: 'Vyper', code: 'viper', skinCategoryId: 33330 },
    { display: 'Warden', code: 'warden', skinCategoryId: 33326 },
    { display: 'Wraith', code: 'wraith', skinCategoryId: 33327 },
    { display: 'Yamato', code: 'yamato', skinCategoryId: 33328 },
];

const localFingerprintCache = new Map<string, {
    size: number;
    mtimeMs: number;
    fingerprint: LocalVpkFingerprint;
}>();

export async function detectUnknownModFilters(
    modId: string,
    fileName: string,
    vpkPath: string,
    options: UnknownModDetectionOptions = {}
): Promise<UnknownModFilterGuess> {
    const emit = (progress: Omit<UnknownModDetectionProgress, 'modId'>) => {
        options.onProgress?.({ modId, requestId: options.requestId, ...progress });
    };
    const empty = (status: UnknownModCrcMatchResult['status'], reason?: string): UnknownModFilterGuess => ({
        modId,
        fileName,
        crcMatch: { status, reason },
    });

    let bestMatch: UnknownModCrcMatchResult | null = null;

    try {
        emit({ phase: 'fingerprinting', message: 'Reading local VPK fingerprint...' });
        const localFile = await getLocalVpkFingerprint(vpkPath, options.signal);
        if (!localFile) {
            return empty('not-found', 'No local VPK file was found.');
        }

        const cached = lookupUnknownCrcMatch(localFile.crc32, localFile.size);
        if (cached) {
            const result = {
                modId,
                fileName,
                crcMatch: toFoundMatch(cached, 'CRC-32 matched cached GameBanana archive data.'),
            };
            emit({
                phase: 'cache-hit',
                message: 'Found a cached CRC match.',
                result,
            });
            return result;
        }

        const paths = parseVpkDirectory(vpkPath) ?? [];
        const buckets = chooseSearchBuckets(paths);
        const firstBucket = buckets[0];
        if (!firstBucket) {
            return empty('not-found', 'No useful VPK clues were found for a GameBanana search.');
        }

        let checkedFiles = 0;
        let checkedMods = 0;
        let discoveredFiles = 0;
        let indexedEntries = 0;
        let bytesFetched = 0;
        let totalCandidateMods = 0;
        let sawCandidateMods = false;
        const seenFileIds = new Set<number>();

        for (const bucket of buckets) {
            emit({
                phase: 'searching',
                message: describeBucket(bucket),
                bucket,
                checkedFiles,
                totalFiles: discoveredFiles,
                indexedEntries,
                bytesFetched,
            });
            let page = 1;
            let totalPages = 1;

            while (page <= totalPages && !bestMatch) {
                throwIfAborted(options.signal);
                const pageResult = await fetchCandidateModsPage(bucket, page, options.signal);
                const perPage = pageResult.perPage || CANDIDATE_PAGE_SIZE;
                totalCandidateMods += page === 1 ? pageResult.totalCount : 0;
                totalPages = Math.max(1, Math.ceil((pageResult.totalCount || pageResult.records.length) / perPage));
                const candidateMods = pageResult.records.filter((mod) => mod.hasFiles);
                checkedMods += candidateMods.length;

                if (candidateMods.length === 0) {
                    page++;
                    continue;
                }
                sawCandidateMods = true;

                emit({
                    phase: 'fetching-files',
                    message: `Fetching file metadata for ${bucketLabel(bucket)} page ${page}/${totalPages} (${candidateMods.length} candidate mod${candidateMods.length === 1 ? '' : 's'})...`,
                    bucket,
                    checkedFiles,
                    totalFiles: discoveredFiles,
                    indexedEntries,
                    bytesFetched,
                });

                const files = (await getCandidateFiles(candidateMods, bucket, options.signal))
                    .filter((file) => {
                        if (seenFileIds.has(file.fileId)) return false;
                        seenFileIds.add(file.fileId);
                        return true;
                    });
                discoveredFiles += files.length;

                for (const file of files) {
                    throwIfAborted(options.signal);
                    if (!shouldProbeArchive(file)) {
                        checkedFiles++;
                        emit({
                            phase: bestMatch ? 'caching-remaining' : 'indexing',
                            message: bestMatch ? 'Caching remaining files on this page...' : 'Checking cached archive status...',
                            bucket,
                            checkedFiles,
                            totalFiles: discoveredFiles,
                            indexedEntries,
                            bytesFetched,
                            currentFileName: file.fileName,
                            result: bestMatch ? { modId, fileName, crcMatch: bestMatch } : undefined,
                        });
                        continue;
                    }

                    emit({
                        phase: bestMatch ? 'caching-remaining' : 'indexing',
                        message: bestMatch ? 'Caching remaining files on this page...' : `Checking archive CRC data for ${bucketLabel(bucket)} page ${page}/${totalPages}...`,
                        bucket,
                        checkedFiles,
                        totalFiles: discoveredFiles,
                        indexedEntries,
                        bytesFetched,
                        currentFileName: file.fileName,
                        result: bestMatch ? { modId, fileName, crcMatch: bestMatch } : undefined,
                    });
                    try {
                        const archive = await fetchGameBananaArchiveVpkCrcEntries(file, { signal: options.signal });
                        bytesFetched += archive.bytesFetched;

                        if (archive.unsupportedReason) {
                            updateUnknownCrcFileStatus(file.fileId, {
                                status: 'unsupported',
                                archiveType: archive.archiveType,
                                bytesFetched: archive.bytesFetched,
                                error: archive.unsupportedReason,
                            });
                            console.log(`[UnknownCrc] Skipped ${file.section}/${file.modId} file ${file.fileId} (${file.fileName}): ${archive.unsupportedReason}`);
                        } else {
                            replaceUnknownCrcEntries(file.fileId, archive.entries, {
                                archiveType: archive.archiveType,
                                bytesFetched: archive.bytesFetched,
                            });
                            indexedEntries += archive.entries.length;
                            logIndexedFile(file, archive.entries.length, archive.bytesFetched);
                        }

                        const matchedEntry = archive.entries.find((entry) =>
                            entry.crc32.toLowerCase() === localFile.crc32 && entry.uncompressedSize === localFile.size
                        );
                        if (!bestMatch && matchedEntry) {
                            bestMatch = toFoundMatch({
                                ...file,
                                entryName: matchedEntry.name,
                                crc32: matchedEntry.crc32,
                                uncompressedSize: matchedEntry.uncompressedSize,
                                compressedSize: matchedEntry.compressedSize,
                            }, `CRC-32 matched ${matchedEntry.name}.`);
                            emit({
                                phase: 'found',
                                message: 'Found a matching GameBanana file. Caching the rest of this page...',
                                bucket,
                                checkedFiles,
                                totalFiles: discoveredFiles,
                                indexedEntries,
                                bytesFetched,
                                currentFileName: file.fileName,
                                result: { modId, fileName, crcMatch: bestMatch },
                            });
                            console.log(`[UnknownCrc] Match found for ${fileName}: ${file.section}/${file.modId} file ${file.fileId}`);
                        }
                    } catch (err) {
                        throwIfAborted(options.signal);
                        updateUnknownCrcFileStatus(file.fileId, {
                            status: 'failed',
                            archiveType: null,
                            bytesFetched: 0,
                            error: errorMessage(err),
                        });
                        console.warn(`[UnknownCrc] Failed ${file.section}/${file.modId} file ${file.fileId} (${file.fileName}): ${errorMessage(err)}`);
                    } finally {
                        checkedFiles++;
                        emit({
                            phase: bestMatch ? 'caching-remaining' : 'indexing',
                            message: bestMatch ? 'Caching remaining files on this page...' : `Checking archive CRC data for ${bucketLabel(bucket)} page ${page}/${totalPages}...`,
                            bucket,
                            checkedFiles,
                            totalFiles: discoveredFiles,
                            indexedEntries,
                            bytesFetched,
                            currentFileName: file.fileName,
                            result: bestMatch ? { modId, fileName, crcMatch: bestMatch } : undefined,
                        });
                    }
                }

                page++;
            }

            if (bestMatch) break;
        }

        if (!sawCandidateMods) {
            return empty('not-found', `No GameBanana candidates with files were returned for ${buckets.map(describeBucket).join('; ')}.`);
        }

        const result = bestMatch
            ? { modId, fileName, crcMatch: bestMatch }
            : empty(
                'not-found',
                `No CRC match found after checking ${checkedMods} candidate mod${checkedMods === 1 ? '' : 's'} across ${totalCandidateMods || checkedMods} bucket result${(totalCandidateMods || checkedMods) === 1 ? '' : 's'} (${checkedFiles} file${checkedFiles === 1 ? '' : 's'} checked). Cached CRC entries: ${getUnknownCrcEntryCount()}.`
            );
        emit({
            phase: 'complete',
            message: bestMatch ? 'Finished caching the matched result page.' : 'Search finished with no match.',
            bucket: firstBucket,
            checkedFiles,
            totalFiles: discoveredFiles,
            indexedEntries,
            bytesFetched,
            result: bestMatch ? result : undefined,
        });
        return result;
    } catch (err) {
        if (bestMatch && options.signal?.aborted) {
            const result = { modId, fileName, crcMatch: bestMatch };
            emit({
                phase: 'cancelled',
                message: 'Stopped caching remaining files.',
                result,
            });
            return result;
        }

        const cancelled = options.signal?.aborted;
        emit({
            phase: cancelled ? 'cancelled' : 'error',
            message: cancelled ? 'Search cancelled.' : errorMessage(err),
        });
        return empty(cancelled ? 'not-found' : 'error', cancelled ? 'Search cancelled.' : errorMessage(err));
    }
}

export async function detectUnknownModCacheMatches(
    inputs: UnknownModCacheMatchInput[],
    options: Pick<UnknownModDetectionOptions, 'onProgress'> = {}
): Promise<UnknownModFilterGuess[]> {
    const vpkInputs = inputs.filter((input) => input.vpkPath.toLowerCase().endsWith('.vpk'));
    const skipped = inputs
        .filter((input) => !input.vpkPath.toLowerCase().endsWith('.vpk'))
        .map((input) => cacheMiss(input, 'No local VPK file was found.'));

    for (const input of vpkInputs) {
        options.onProgress?.({
            modId: input.modId,
            requestId: input.requestId,
            phase: 'fingerprinting',
            message: 'Checking local CRC cache...',
        });
    }

    const fingerprints = await fingerprintFilesInWorkers(
        vpkInputs.map((input) => ({ id: input.modId, filePath: input.vpkPath })),
        { concurrency: CACHE_FINGERPRINT_CONCURRENCY }
    );
    const inputById = new Map(vpkInputs.map((input) => [input.modId, input]));
    const results: UnknownModFilterGuess[] = [];
    const fingerprintResults: Array<{ input: UnknownModCacheMatchInput; fingerprint: FileFingerprintResult }> = [];

    for (const fingerprint of fingerprints) {
        const input = inputById.get(fingerprint.id);
        if (!input) {
            continue;
        }
        if (fingerprint.error) {
            results.push(cacheMiss(input, fingerprint.error));
            continue;
        }

        rememberFingerprint(input.vpkPath, fingerprint);
        fingerprintResults.push({ input, fingerprint });
    }

    const cachedMatches = lookupUnknownCrcMatches(fingerprintResults.map(({ fingerprint }) => ({
        key: fingerprint.id,
        crc32: fingerprint.crc32,
        uncompressedSize: fingerprint.size,
    })));

    for (const { input, fingerprint } of fingerprintResults) {
        const cached = cachedMatches.get(fingerprint.id);
        if (!cached) {
            results.push(cacheMiss(input, 'No cached CRC match found yet.'));
            continue;
        }

        const result = {
            modId: input.modId,
            fileName: input.fileName,
            crcMatch: toFoundMatch(cached, 'CRC-32 matched cached GameBanana archive data.'),
        };
        options.onProgress?.({
            modId: input.modId,
            requestId: input.requestId,
            phase: 'cache-hit',
            message: 'Found a cached CRC match.',
            result,
        });
        results.push(result);
    }

    return [...results, ...skipped];
}

async function getLocalVpkFingerprint(vpkPath: string, signal?: AbortSignal): Promise<LocalVpkFingerprint | null> {
    if (!vpkPath.toLowerCase().endsWith('.vpk')) return null;

    throwIfAborted(signal);
    const stats = await fs.stat(vpkPath);
    const cached = localFingerprintCache.get(vpkPath);
    if (cached?.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
        return cached.fingerprint;
    }

    const fingerprint = {
        size: stats.size,
        crc32: await crc32File(vpkPath, signal),
    };
    localFingerprintCache.set(vpkPath, {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        fingerprint,
    });
    if (localFingerprintCache.size > LOCAL_FINGERPRINT_CACHE_MAX) {
        const oldestKey = localFingerprintCache.keys().next().value;
        if (oldestKey) localFingerprintCache.delete(oldestKey);
    }
    return fingerprint;
}

function rememberFingerprint(vpkPath: string, result: FileFingerprintResult): void {
    if (result.error) return;
    localFingerprintCache.set(vpkPath, {
        size: result.size,
        mtimeMs: result.mtimeMs,
        fingerprint: {
            size: result.size,
            crc32: result.crc32.toLowerCase(),
        },
    });
    if (localFingerprintCache.size > LOCAL_FINGERPRINT_CACHE_MAX) {
        const oldestKey = localFingerprintCache.keys().next().value;
        if (oldestKey) localFingerprintCache.delete(oldestKey);
    }
}

function cacheMiss(input: UnknownModCacheMatchInput, reason: string): UnknownModFilterGuess {
    return {
        modId: input.modId,
        fileName: input.fileName,
        crcMatch: { status: 'not-found', reason },
    };
}

async function fetchCandidateModsPage(
    bucket: SearchBucket,
    page: number,
    signal?: AbortSignal
): Promise<GameBananaModsResponse> {
    const response = await fetchSubmissions(
        bucket.section,
        page,
        CANDIDATE_PAGE_SIZE,
        bucket.search,
        bucket.categoryId,
        'default',
        { signal }
    );
    console.log(
        `[UnknownCrc] Candidate bucket ${bucket.section}/${bucket.categoryName ?? 'All'} search="${bucket.search ?? ''}" page ${page} returned ${response.records.length}/${response.totalCount}`
    );
    return response;
}

async function getCandidateFiles(
    candidateMods: GameBananaMod[],
    bucket: SearchBucket,
    signal?: AbortSignal
): Promise<UnknownCrcFile[]> {
    const cachedByMod = getUnknownCrcFilesForMods(candidateMods.map((mod) => ({
        modId: mod.id,
        section: bucket.section,
        dateModified: mod.dateModified,
    })));
    const cachedFiles: UnknownCrcFile[] = [];
    const uncachedMods: GameBananaMod[] = [];

    for (const mod of candidateMods) {
        const cached = cachedByMod.get(`${bucket.section}:${mod.id}`);
        if (cached?.length) {
            cachedFiles.push(...cached);
        } else {
            uncachedMods.push(mod);
        }
    }

    if (uncachedMods.length === 0) {
        return sortCandidateFiles(cachedFiles);
    }

    const metadata = await fetchModsFilesMetadata(
        uncachedMods.map((mod) => ({ id: mod.id, section: bucket.section })),
        true,
        { signal }
    );
    return sortCandidateFiles([
        ...cachedFiles,
        ...cacheCandidateFiles(uncachedMods, metadata, bucket),
    ]);
}

function cacheCandidateFiles(
    mods: GameBananaMod[],
    results: GameBananaFileMetadataResult[],
    bucket: SearchBucket
): UnknownCrcFile[] {
    const modByKey = new Map(mods.map((mod) => [`${bucket.section}:${mod.id}`, mod]));
    const files: UnknownCrcFileInput[] = [];

    for (const result of results) {
        if (result.error) {
            console.warn(`[UnknownCrc] File metadata failed for ${result.section}/${result.modId}: ${result.error}`);
            continue;
        }

        const mod = modByKey.get(`${result.section}:${result.modId}`);
        if (!mod) continue;
        for (const file of result.files) {
            files.push({
                fileId: file.id,
                modId: mod.id,
                modName: mod.name,
                section: result.section,
                categoryName: bucket.categoryName ?? mod.rootCategory?.name ?? null,
                thumbnailUrl: getThumbnailUrl(mod),
                nsfw: mod.nsfw,
                dateModified: mod.dateModified,
                fileName: file.fileName,
                fileSize: file.fileSize,
                downloadUrl: file.downloadUrl,
                isArchived: file.isArchived,
                md5: file.md5 ?? null,
            });
        }
    }

    console.log(`[UnknownCrc] Cached metadata for ${mods.length} candidate mod(s), ${files.length} file(s).`);
    return sortCandidateFiles(upsertUnknownCrcFiles(files));
}

function sortCandidateFiles(files: UnknownCrcFile[]): UnknownCrcFile[] {
    return files.slice()
        .sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || b.dateModified - a.dateModified || b.fileId - a.fileId);
}

function chooseSearchBuckets(paths: string[]): SearchBucket[] {
    const normalized = paths.map((path) => path.replace(/\\/g, '/').toLowerCase());
    const hero = findHeroHint(normalized);
    const ranked = scoreCategories(normalized);

    if (ranked.length === 0) {
        ranked.push({ key: 'modMisc', points: 1 });
    }

    const seen = new Set<string>();
    // Unknown search intentionally probes only the best-scoring Browser bucket.
    // CRC cache hits handle future searches, while one bucket keeps each live
    // search bounded and avoids hammering GameBanana.
    const buckets: SearchBucket[] = [];
    for (const { key, points } of ranked.slice(0, 1)) {
        const target = resolveCategoryTarget(key, hero);
        const search = searchForTarget(key, hero);
        const bucket = {
            ...target,
            search,
            label: buildBucketLabel(key, target, points, hero, search),
        };
        const dedupeKey = `${bucket.section}:${bucket.categoryId ?? ''}:${bucket.search ?? ''}`;
        if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            buckets.push(bucket);
        }
    }

    return buckets;
}

function scoreCategories(paths: string[]): Array<{ key: CategoryKey; points: number }> {
    const scores = new Map<CategoryKey, number>();
    const hasModelPath = paths.some((path) => MODEL_PATH_PATTERN.test(path));
    for (const path of paths) {
        for (const rule of CATEGORY_PATH_RULES) {
            if (!rule.pattern.test(path)) continue;
            for (const key of Object.keys(rule.points) as CategoryKey[]) {
                const points = rule.points[key] ?? 0;
                scores.set(key, (scores.get(key) ?? 0) + points);
            }
        }
    }

    return [...scores.entries()]
        .map(([key, points]) => ({ key, points }))
        .filter(({ key, points }) => points > 0 && !(hasModelPath && key === 'soundMisc'))
        .sort((a, b) => b.points - a.points || categoryTieBreaker(a.key) - categoryTieBreaker(b.key));
}

function categoryTieBreaker(key: CategoryKey): number {
    const index = CATEGORY_TIE_BREAKERS.indexOf(key);
    return index === -1 ? CATEGORY_TIE_BREAKERS.length : index;
}

function searchForTarget(key: CategoryKey, hero: HeroHint | null): string | undefined {
    if (!hero) return undefined;
    if (key === 'skins') return undefined;
    if (key === 'modelReplacement' || CATEGORY_TARGETS[key].section === 'Sound') {
        return hero.display;
    }
    return undefined;
}

function resolveCategoryTarget(key: CategoryKey, hero: HeroHint | null): CategoryTarget {
    if (key === 'skins' && hero) {
        return {
            section: 'Mod',
            categoryId: hero.skinCategoryId,
            categoryName: `Skins/${hero.display}`,
        };
    }
    return CATEGORY_TARGETS[key];
}

function buildBucketLabel(
    key: CategoryKey,
    target: CategoryTarget,
    points: number,
    hero: HeroHint | null,
    search?: string
): string {
    const prefix = `${target.categoryName} scored ${points} from VPK paths.`;
    if (key === 'skins' && hero) return `${prefix} Using ${hero.display}'s Skins category.`;
    return search && hero ? `${prefix} Searching ${hero.display}.` : prefix;
}

function shouldProbeArchive(file: UnknownCrcFile): boolean {
    if (file.status === 'pending') return true;
    if (file.status === 'unsupported') return file.parserVersion < UNKNOWN_CRC_PARSER_VERSION;
    if (file.status === 'failed') {
        return !file.checkedAt || (Date.now() / 1000) - file.checkedAt >= FAILED_RETRY_SECONDS;
    }
    return false;
}

function findHeroHint(paths: string[]): HeroHint | null {
    const scores = new Map<HeroHint, number>();

    for (const path of paths) {
        const segments = path.split(/[/_.\s-]+/).filter(Boolean).map(normalizeHeroKey);
        const compactPath = normalizeHeroKey(path);
        for (const hero of HERO_HINTS) {
            const code = normalizeHeroKey(hero.code);
            const display = normalizeHeroKey(hero.display);
            if (
                segments.includes(code) ||
                segments.includes(display) ||
                (code.length > 3 && compactPath.includes(code)) ||
                (display.length > 4 && compactPath.includes(display))
            ) {
                scores.set(hero, (scores.get(hero) ?? 0) + scoreHeroPath(path));
            }
        }
    }

    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    return best?.[0] ?? null;
}

function normalizeHeroKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function scoreHeroPath(path: string): number {
    if (/models\/heroes(?:_wip|_staging)?\//.test(path)) return 4;
    if (/materials\/models\/heroes(?:_wip|_staging)?\//.test(path)) return 3;
    if (/soundevents|sounds?|scripts\/tagged_sounds|particles\/abilities|panorama\/images\/hud\/abilities/.test(path)) return 2;
    return 1;
}

function toFoundMatch(
    match: UnknownCrcLookupMatch | (UnknownCrcFile & {
        entryName: string;
        crc32: string;
        uncompressedSize: number;
        compressedSize: number;
    }),
    reason: string
): UnknownModCrcMatchResult {
    return {
        status: 'found',
        modId: match.modId,
        modName: match.modName,
        thumbnailUrl: match.thumbnailUrl ?? undefined,
        nsfw: match.nsfw,
        fileId: match.fileId,
        fileName: match.fileName,
        section: match.section,
        categoryName: match.categoryName ?? undefined,
        reason,
    };
}

function getThumbnailUrl(mod: GameBananaMod): string | null {
    const thumbnail = mod.previewMedia?.images?.[0];
    return thumbnail ? `${thumbnail.baseUrl}/${thumbnail.file530 || thumbnail.file || thumbnail.file220}` : null;
}

function describeBucket(bucket: SearchBucket): string {
    const category = bucket.categoryName ? `/${bucket.categoryName}` : '';
    const search = bucket.search ? ` for "${bucket.search}"` : '';
    return `Searching ${bucket.section}${category}${search}. ${bucket.label}`;
}

function bucketLabel(bucket: SearchBucket): string {
    const category = bucket.categoryName ?? (bucket.categoryId ? `Category ${bucket.categoryId}` : 'All');
    const search = bucket.search ? ` search "${bucket.search}"` : '';
    return `${bucket.section}/${category}${search}`;
}

function logIndexedFile(file: UnknownCrcFile, entryCount: number, bytesFetched: number): void {
    const detail = entryCount === 0 ? 'no VPK entries found' : `${entryCount} VPK entr${entryCount === 1 ? 'y' : 'ies'}`;
    console.log(
        `[UnknownCrc] Indexed ${file.section}/${file.modId} file ${file.fileId} (${file.fileName}): ${detail}; fetched ${bytesFetched.toLocaleString()} bytes`
    );
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error('Unknown mod search cancelled');
    }
}
