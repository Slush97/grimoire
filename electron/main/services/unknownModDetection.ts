import { promises as fs } from 'fs';
import { basename } from 'path';
import {
    fetchCategoryTree,
    fetchModFilesWithRawPaths,
    fetchSubmissions,
    type GameBananaCategoryNode,
    type GameBananaFileWithRawPaths,
    type GameBananaMod,
} from './gamebanana';
import {
    crc32File,
    fetchGameBananaArchiveVpkCrcEntries,
    type ArchiveVpkCrcEntry,
} from './archiveCrc';
import { parseVpkDirectory } from './vpk';
import type { UnknownModCrcMatchResult, UnknownModFilterGuess } from '../../../src/types/mod';

export type { UnknownModFilterGuess };

type UnknownModFilterBase = Omit<UnknownModFilterGuess, 'crcMatch'>;

export interface UnknownModDetectionOptions {
    signal?: AbortSignal;
}

type SignalStrength = 'strong' | 'medium' | 'weak';

interface HeroNamePair {
    name: string;
    fileName: string;
}

interface HeroSignal {
    hero: HeroNamePair;
    strength: SignalStrength;
    clue: string;
}

interface SignalPattern {
    pattern: RegExp;
    strength: SignalStrength;
    label: string;
}

// These names mirror the current GameBanana Deadlock > Mods > Skins categories.
// Each hero intentionally has only two names: the GameBanana display name and
// the common VPK folder/file token used by Deadlock assets.
const HERO_NAME_PAIRS: HeroNamePair[] = [
    { name: 'Abrams', fileName: 'atlas' },
    { name: 'Apollo', fileName: 'fencer' },
    { name: 'Bebop', fileName: 'bebop' },
    { name: 'Billy', fileName: 'punkgoat' },
    { name: 'Calico', fileName: 'nano' },
    { name: 'Celeste', fileName: 'unicorn' },
    { name: 'Doorman', fileName: 'doorman' },
    { name: 'Drifter', fileName: 'drifter' },
    { name: 'Dynamo', fileName: 'dynamo' },
    { name: 'Graves', fileName: 'necro' },
    { name: 'Grey Talon', fileName: 'orion' },
    { name: 'Haze', fileName: 'haze' },
    { name: 'Holliday', fileName: 'astro' },
    { name: 'Infernus', fileName: 'inferno' },
    { name: 'Ivy', fileName: 'tengu' },
    { name: 'Kelvin', fileName: 'kelvin' },
    { name: 'Lady Geist', fileName: 'geist' },
    { name: 'Lash', fileName: 'lash' },
    { name: 'McGinnis', fileName: 'forge' },
    { name: 'Mina', fileName: 'vampirebat' },
    { name: 'Mirage', fileName: 'mirage' },
    { name: 'Mo & Krill', fileName: 'krill' },
    { name: 'Paige', fileName: 'bookworm' },
    { name: 'Paradox', fileName: 'chrono' },
    { name: 'Pocket', fileName: 'synth' },
    { name: 'Rem', fileName: 'familiar' },
    { name: 'Seven', fileName: 'gigawatt' },
    { name: 'Shiv', fileName: 'shiv' },
    { name: 'Silver', fileName: 'werewolf' },
    { name: 'Sinclair', fileName: 'magician' },
    { name: 'Venator', fileName: 'priest' },
    { name: 'Victor', fileName: 'frank' },
    { name: 'Vindicta', fileName: 'hornet' },
    { name: 'Viscous', fileName: 'viscous' },
    { name: 'Vyper', fileName: 'viper' },
    { name: 'Warden', fileName: 'warden' },
    { name: 'Wraith', fileName: 'wraith' },
    { name: 'Yamato', fileName: 'yamato' },
];

const HERO_BY_KEY = new Map<string, HeroNamePair>();
for (const hero of HERO_NAME_PAIRS) {
    HERO_BY_KEY.set(normalizeHeroKey(hero.name), hero);
    HERO_BY_KEY.set(normalizeHeroKey(hero.fileName), hero);
}

const HERO_SIGNAL_PATTERNS: SignalPattern[] = [
    { pattern: /(?:^|\/)models\/heroes(?:_wip|_staging)?\/([^/]+)/i, strength: 'strong', label: 'model hero folder' },
    { pattern: /(?:^|\/)materials\/models\/heroes(?:_wip|_staging)?\/([^/]+)/i, strength: 'strong', label: 'model material folder' },
    { pattern: /(?:^|\/)materials\/heroes(?:_wip|_staging)?\/([^/]+)/i, strength: 'medium', label: 'hero material folder' },
    { pattern: /(?:^|\/)animgraphs\/animgraph2\/hero\/([^/]+)/i, strength: 'medium', label: 'hero animgraph folder' },
    { pattern: /(?:^|\/)panorama\/images\/heroes\/(?:backgrounds|hero_names)\/([^/]+)/i, strength: 'medium', label: 'hero select UI' },
    { pattern: /(?:^|\/)panorama\/images\/hud\/abilities\/([^/]+)/i, strength: 'medium', label: 'ability UI' },
    { pattern: /(?:^|\/)particles\/abilities\/([^/]+)/i, strength: 'medium', label: 'ability particles' },
    { pattern: /(?:^|\/)materials\/particle\/abilities\/([^/]+)/i, strength: 'medium', label: 'ability particle materials' },
    { pattern: /(?:^|\/)soundevents\/hero\/([^/]+)/i, strength: 'medium', label: 'hero sound events' },
    { pattern: /(?:^|\/)sounds\/vo\/([^/]+)/i, strength: 'medium', label: 'voice folder' },
    { pattern: /(?:^|\/)sounds\/abilities\/([^/]+)/i, strength: 'medium', label: 'ability sounds' },
    { pattern: /(?:^|\/)sounds\/weapons\/([^/]+)/i, strength: 'medium', label: 'weapon sounds' },
    { pattern: /(?:^|\/)scripts\/tagged_sounds\/([^/.]+)/i, strength: 'weak', label: 'tagged sound script' },
];

const SCORE: Record<SignalStrength, number> = {
    strong: 100,
    medium: 40,
    weak: 15,
};

export async function detectUnknownModFilters(
    modId: string,
    fileName: string,
    vpkPath: string,
    options: UnknownModDetectionOptions = {}
): Promise<UnknownModFilterGuess> {
    throwIfAborted(options.signal);
    const paths = parseVpkDirectory(vpkPath) ?? [];
    const normalizedPaths = paths.map(normalizePath);
    const contentHints = detectContentHints(normalizedPaths);
    const heroSignals = detectHeroSignals(normalizedPaths);
    const detectedHeroes = summarizeHeroSignals(heroSignals);
    const primaryHero = choosePrimaryHero(detectedHeroes);
    const kind = chooseFilterKind(contentHints, primaryHero);

    const search = primaryHero?.name ?? kind.searchFallback ?? null;
    const reasons = buildReasons(kind, primaryHero, detectedHeroes, contentHints);

    const guessWithoutMatch: UnknownModFilterBase = {
        modId,
        fileName,
        fileCount: paths.length,
        section: kind.section,
        search,
        heroName: primaryHero?.name,
        heroFileName: primaryHero?.fileName,
        categoryName: kind.categoryName,
        confidence: chooseConfidence(primaryHero, kind, paths.length),
        contentHints,
        reasons,
        detectedHeroes,
        samplePaths: paths.slice(0, 8),
    };

    return {
        ...guessWithoutMatch,
        crcMatch: await findUnknownModCrcMatch(vpkPath, guessWithoutMatch, options),
    };
}

interface LocalVpkFingerprint {
    size: number;
    crc32: string;
}

interface CandidateBucket {
    section: 'Mod' | 'Sound';
    categoryId?: number;
    search?: string;
    label: string;
}

let modCategoryTreePromise: Promise<GameBananaCategoryNode[]> | null = null;
const MAX_CRC_ERROR_MESSAGES = 8;
const CANDIDATE_CHECK_CONCURRENCY = 4;

async function findUnknownModCrcMatch(
    vpkPath: string,
    guess: UnknownModFilterBase,
    options: UnknownModDetectionOptions
): Promise<UnknownModCrcMatchResult> {
    const empty = (status: UnknownModCrcMatchResult['status'], reason?: string): UnknownModCrcMatchResult => ({
        status,
        reason,
        searchedBuckets: [],
        checkedMods: 0,
        checkedFiles: 0,
        bytesFetched: 0,
        skipped7z: 0,
        errors: [],
    });

    if (!guess.heroName && !guess.categoryName) {
        return empty('not-found', 'No useful hero or category clue was found, so CRC matching was not attempted.');
    }

    try {
        throwIfAborted(options.signal);
        const buckets = await buildCandidateBuckets(guess, options);
        if (buckets.length === 0) {
            return empty('not-found', 'No GameBanana candidate bucket could be inferred from this VPK.');
        }

        const localFile = await getLocalVpkFingerprint(vpkPath);
        if (!localFile) {
            return empty('not-found', 'No local VPK file was found.');
        }

        const result: UnknownModCrcMatchResult = {
            status: 'not-found',
            reason: 'No GameBanana file matched this local VPK by CRC-32.',
            searchedBuckets: buckets.map((bucket) => bucket.label),
            checkedMods: 0,
            checkedFiles: 0,
            bytesFetched: 0,
            skipped7z: 0,
            errors: [],
        };

        for (const bucket of buckets) {
            throwIfAborted(options.signal);
            const candidates = await fetchBucketCandidates(bucket, options);
            for (let start = 0; start < candidates.length; start += CANDIDATE_CHECK_CONCURRENCY) {
                throwIfAborted(options.signal);
                const batch = candidates.slice(start, start + CANDIDATE_CHECK_CONCURRENCY);
                const checks = await Promise.all(
                    batch.map((candidate) => checkCandidateForCrcMatch(candidate, bucket, localFile, options))
                );

                for (const check of checks) {
                    result.checkedMods += 1;
                    result.checkedFiles += check.checkedFiles;
                    result.bytesFetched += check.bytesFetched;
                    result.skipped7z += check.skipped7z;
                    for (const message of check.errors) {
                        appendCrcError(result, message);
                    }
                }

                const match = checks.find((check) => check.match)?.match;
                if (match) {
                    return {
                        ...result,
                        ...match,
                        status: 'found',
                        confidence: 'exact',
                        reason: 'CRC-32 matched the local VPK file.',
                    };
                }
            }
        }

        return result;
    } catch (err) {
        return {
            status: 'error',
            reason: errorMessage(err),
            searchedBuckets: [],
            checkedMods: 0,
            checkedFiles: 0,
            bytesFetched: 0,
            skipped7z: 0,
            errors: [errorMessage(err)],
        };
    }
}

async function getLocalVpkFingerprint(vpkPath: string): Promise<LocalVpkFingerprint | null> {
    const primaryFileName = basename(vpkPath);
    if (!primaryFileName.toLowerCase().endsWith('_dir.vpk')) return null;

    const [stats, crc32] = await Promise.all([
        fs.stat(vpkPath),
        crc32File(vpkPath),
    ]);
    return { size: stats.size, crc32 };
}

async function buildCandidateBuckets(
    guess: UnknownModFilterBase,
    options: UnknownModDetectionOptions
): Promise<CandidateBucket[]> {
    throwIfAborted(options.signal);
    const modCategories = await getModCategoryTree(options);
    throwIfAborted(options.signal);
    const buckets: CandidateBucket[] = [];
    const add = (bucket: CandidateBucket) => {
        const key = candidateBucketKey(bucket);
        if (!buckets.some((existing) => candidateBucketKey(existing) === key)) {
            buckets.push(bucket);
        }
    };

    if (guess.heroName && guess.section === 'Sound') {
        add({ section: 'Sound', search: guess.heroName, label: `Sounds search: ${guess.heroName}` });
        add({ section: 'Mod', search: guess.heroName, label: `Mods search: ${guess.heroName}` });
        return buckets;
    }

    if (guess.heroName) {
        const skins = findCategoryByName(modCategories, 'Skins');
        const heroCategory = skins?.children?.find(
            (category) => normalizeHeroKey(category.name) === normalizeHeroKey(guess.heroName!)
        );

        if (heroCategory) {
            add({ section: 'Mod', categoryId: heroCategory.id, label: `Mods / Skins / ${heroCategory.name}` });
        }
        add({ section: 'Mod', search: guess.heroName, label: `Mods search: ${guess.heroName}` });
        add({ section: 'Sound', search: guess.heroName, label: `Sounds search: ${guess.heroName}` });
        return buckets;
    }

    if (guess.categoryName) {
        const category = findCategoryByName(modCategories, guess.categoryName);
        if (category) {
            add({ section: 'Mod', categoryId: category.id, label: `Mods / ${category.name}` });
        }
    }
    if (guess.search) {
        add({ section: 'Mod', search: guess.search, label: `Mods search: ${guess.search}` });
    }

    return buckets;
}

function candidateBucketKey(bucket: CandidateBucket): string {
    return `${bucket.section}|${bucket.categoryId ?? ''}|${bucket.search ?? ''}`;
}

function appendCrcError(result: UnknownModCrcMatchResult, message: string): void {
    if (result.errors.length < MAX_CRC_ERROR_MESSAGES) {
        result.errors.push(message);
    }
}

interface CandidateCrcCheck {
    checkedFiles: number;
    bytesFetched: number;
    skipped7z: number;
    errors: string[];
    match?: Pick<
        UnknownModCrcMatchResult,
        'modId' | 'modName' | 'thumbnailUrl' | 'nsfw' | 'fileId' | 'fileName' | 'section' | 'categoryName'
    >;
}

async function checkCandidateForCrcMatch(
    candidate: GameBananaMod,
    bucket: CandidateBucket,
    localFile: LocalVpkFingerprint,
    options: UnknownModDetectionOptions
): Promise<CandidateCrcCheck> {
    const result: CandidateCrcCheck = {
        checkedFiles: 0,
        bytesFetched: 0,
        skipped7z: 0,
        errors: [],
    };

    let files: GameBananaFileWithRawPaths[];
    try {
        throwIfAborted(options.signal);
        files = await fetchModFilesWithRawPaths(candidate.id, bucket.section, true, { signal: options.signal });
    } catch (err) {
        result.errors.push(`${candidate.name}: failed to read files (${errorMessage(err)})`);
        return result;
    }

    for (const file of files) {
        throwIfAborted(options.signal);
        if (file.rawVpkPathsError) {
            result.errors.push(`${candidate.name} / ${file.fileName}: RawFileList failed (${file.rawVpkPathsError})`);
            continue;
        }
        if (!rawVpkPathsCouldMatch(file.rawVpkPaths)) {
            continue;
        }

        result.checkedFiles++;
        try {
            const archive = await fetchGameBananaArchiveVpkCrcEntries(file, { signal: options.signal });
            result.bytesFetched += archive.bytesFetched;
            if (archive.archiveType === '7z' && archive.unsupportedReason) {
                result.skipped7z++;
            }
            if (archiveMatchesLocalVpk(localFile, archive.entries)) {
                result.match = {
                    modId: candidate.id,
                    modName: candidate.name,
                    thumbnailUrl: thumbnailUrlForCandidate(candidate),
                    nsfw: candidate.nsfw,
                    fileId: file.id,
                    fileName: file.fileName,
                    section: bucket.section,
                    categoryName: candidate.rootCategory?.name,
                };
                return result;
            }
        } catch (err) {
            result.errors.push(`${candidate.name} / ${file.fileName}: ${errorMessage(err)}`);
        }
    }

    return result;
}

function thumbnailUrlForCandidate(candidate: GameBananaMod): string | undefined {
    const image = candidate.previewMedia?.images?.[0];
    if (!image?.baseUrl) return undefined;

    const file = image.file530 || image.file || image.file220;
    return file ? `${image.baseUrl}/${file}` : undefined;
}

async function getModCategoryTree(options: UnknownModDetectionOptions = {}): Promise<GameBananaCategoryNode[]> {
    if (options.signal) {
        return fetchCategoryTree('ModCategory', { signal: options.signal });
    }
    modCategoryTreePromise ??= fetchCategoryTree('ModCategory');
    return modCategoryTreePromise;
}

function findCategoryByName(
    categories: GameBananaCategoryNode[],
    name: string
): GameBananaCategoryNode | undefined {
    for (const category of categories) {
        if (category.name.toLowerCase() === name.toLowerCase()) {
            return category;
        }
        const child = category.children ? findCategoryByName(category.children, name) : undefined;
        if (child) return child;
    }
    return undefined;
}

async function fetchBucketCandidates(
    bucket: CandidateBucket,
    options: UnknownModDetectionOptions
): Promise<GameBananaMod[]> {
    const perPage = 50;
    const maxPages = 4;
    const byId = new Map<number, GameBananaMod>();

    for (let page = 1; page <= maxPages; page++) {
        throwIfAborted(options.signal);
        const response = await fetchSubmissions(
            bucket.section,
            page,
            perPage,
            bucket.search,
            bucket.categoryId,
            undefined,
            { signal: options.signal }
        );

        for (const mod of response.records) {
            if (mod.hasFiles) byId.set(mod.id, mod);
        }

        if (response.isComplete || response.records.length < perPage) {
            break;
        }
    }

    return [...byId.values()];
}

function rawVpkPathsCouldMatch(rawPaths: string[]): boolean {
    if (rawPaths.length === 0) return false;
    return rawPaths.some((rawPath) => rawPath.toLowerCase().endsWith('_dir.vpk'));
}

function archiveMatchesLocalVpk(localFile: LocalVpkFingerprint, archiveEntries: ArchiveVpkCrcEntry[]): boolean {
    return archiveEntries.some((entry) => (
        entry.name.toLowerCase().endsWith('_dir.vpk') &&
        entry.uncompressedSize === localFile.size &&
        entry.crc32.toLowerCase() === localFile.crc32
    ));
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error('Unknown mod search cancelled');
    }
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
}

function normalizeHeroKey(value: string): string {
    return value
        .replace(/^hero_/i, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function tokenVariants(raw: string): string[] {
    const normalized = normalizeHeroKey(raw);
    const compact = normalized.replace(/\s+/g, '');
    const first = normalized.split(' ')[0] ?? normalized;
    const withoutSuffix = normalized
        .replace(/\s+(?:v\d+|copy|alt|temp|test)\b.*$/i, '')
        .trim();
    const withoutNumberSuffix = normalized
        .replace(/\s+v?\d+\b.*$/i, '')
        .trim();

    return [...new Set([normalized, compact, withoutSuffix, withoutNumberSuffix, first].filter(Boolean))];
}

function findHeroFromToken(raw: string): HeroNamePair | null {
    for (const variant of tokenVariants(raw)) {
        const exact = HERO_BY_KEY.get(variant);
        if (exact) return exact;
    }

    const normalized = ` ${normalizeHeroKey(raw)} `;
    for (const hero of HERO_NAME_PAIRS) {
        const displayName = normalizeHeroKey(hero.name);
        const fileName = normalizeHeroKey(hero.fileName);
        if (normalized.includes(` ${displayName} `) || normalized.includes(` ${fileName} `)) {
            return hero;
        }
    }

    return null;
}

function detectHeroSignals(paths: string[]): HeroSignal[] {
    const signals: HeroSignal[] = [];

    for (const path of paths) {
        for (const { pattern, strength, label } of HERO_SIGNAL_PATTERNS) {
            const match = path.match(pattern);
            if (!match?.[1]) continue;

            const hero = findHeroFromToken(match[1]);
            if (!hero) continue;
            signals.push({
                hero,
                strength,
                clue: `${label}: ${match[1]}`,
            });
        }
    }

    return signals;
}

function summarizeHeroSignals(signals: HeroSignal[]): UnknownModFilterGuess['detectedHeroes'] {
    const byHero = new Map<string, {
        name: string;
        fileName: string;
        score: number;
        strongestSignal: SignalStrength;
        clues: Set<string>;
    }>();

    for (const signal of signals) {
        const existing = byHero.get(signal.hero.name) ?? {
            name: signal.hero.name,
            fileName: signal.hero.fileName,
            score: 0,
            strongestSignal: signal.strength,
            clues: new Set<string>(),
        };
        existing.score += SCORE[signal.strength];
        if (SCORE[signal.strength] > SCORE[existing.strongestSignal]) {
            existing.strongestSignal = signal.strength;
        }
        if (existing.clues.size < 5) existing.clues.add(signal.clue);
        byHero.set(signal.hero.name, existing);
    }

    return [...byHero.values()]
        .map((hero) => ({
            ...hero,
            clues: [...hero.clues],
        }))
        .sort((a, b) => b.score - a.score);
}

function choosePrimaryHero(
    heroes: UnknownModFilterGuess['detectedHeroes']
): UnknownModFilterGuess['detectedHeroes'][number] | undefined {
    const strong = heroes.filter((hero) => hero.strongestSignal === 'strong');
    if (strong.length > 0) return strong[0];
    return heroes[0];
}

function detectContentHints(paths: string[]): string[] {
    const hints = new Set<string>();

    for (const path of paths) {
        if (/^models\/|\/models\//i.test(path) || /^materials\/models\//i.test(path)) hints.add('Model');
        if (/^sounds\/|^soundevents\//i.test(path)) hints.add('Sound');
        if (/^panorama\//i.test(path)) hints.add('UI');
        if (/^panorama\/images\/heroes\/(?:backgrounds|hero_names)\//i.test(path)) hints.add('Hero Select UI');
        if (/^particles\/|^materials\/particle\//i.test(path)) hints.add('VFX');
        if (/^postprocessing\//i.test(path) || /\.vpost_c$/i.test(path)) hints.add('Post Processing');
        if (/^maps\//i.test(path)) hints.add('Map');
        if (/^materials\/skybox\//i.test(path)) hints.add('Skybox');
        if (/weapons?\//i.test(path)) hints.add('Weapon');
    }

    return [...hints];
}

function chooseFilterKind(
    hints: string[],
    primaryHero: UnknownModFilterGuess['detectedHeroes'][number] | undefined
): { section: 'Mod' | 'Sound'; categoryName?: string; searchFallback?: string } {
    const has = (hint: string) => hints.includes(hint);
    const modelLike = has('Model') || has('VFX');
    const soundOnly = has('Sound') && !modelLike && !has('UI') && !has('Map') && !has('Skybox');

    if (soundOnly) {
        return { section: 'Sound' };
    }

    if (has('Map') || has('Skybox')) {
        return { section: 'Mod', categoryName: 'Maps', searchFallback: has('Skybox') ? 'skybox' : 'map' };
    }

    if (has('UI') && !modelLike) {
        return { section: 'Mod', categoryName: 'HUD', searchFallback: primaryHero ? undefined : 'hud' };
    }

    if (has('Post Processing')) {
        return { section: 'Mod', categoryName: 'Other/Misc', searchFallback: 'postprocess' };
    }

    if (modelLike) {
        return { section: 'Mod', categoryName: primaryHero ? 'Skins' : 'Model Replacement' };
    }

    return { section: 'Mod', categoryName: 'Other/Misc' };
}

function chooseConfidence(
    primaryHero: UnknownModFilterGuess['detectedHeroes'][number] | undefined,
    kind: { categoryName?: string },
    fileCount: number
): UnknownModFilterGuess['confidence'] {
    if (primaryHero?.strongestSignal === 'strong') return 'high';
    if (primaryHero || kind.categoryName) return 'medium';
    if (fileCount > 0) return 'low';
    return 'low';
}

function buildReasons(
    kind: { section: 'Mod' | 'Sound'; categoryName?: string },
    primaryHero: UnknownModFilterGuess['detectedHeroes'][number] | undefined,
    detectedHeroes: UnknownModFilterGuess['detectedHeroes'],
    hints: string[]
): string[] {
    const reasons: string[] = [];

    if (primaryHero) {
        reasons.push(
            `Detected ${primaryHero.name} from ${primaryHero.strongestSignal} VPK path clues (${primaryHero.fileName}).`
        );
    }
    if (detectedHeroes.length > 1) {
        reasons.push(
            `Using ${primaryHero?.name ?? detectedHeroes[0].name} first because it has the strongest/most repeated clues.`
        );
    }
    if (kind.section === 'Sound') {
        reasons.push('Sound-only contents map best to the Browser Sound section.');
    } else {
        reasons.push('Contents map best to the Browser Mods section.');
    }
    if (kind.categoryName) {
        reasons.push(`Suggested category filter: ${kind.categoryName}.`);
    }
    if (hints.length > 0) {
        reasons.push(`Content hints: ${hints.join(', ')}.`);
    }

    return reasons;
}
