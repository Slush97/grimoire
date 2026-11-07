import { HERO_ALIASES } from '@grimoire/social-types/heroes';
import type { GlobalModType, InstalledHeroDetection, LockerHeroSource } from '../../../src/types/mod';
import { categoryGeneralType, categoryHeroName, resolveCategoryPath, resolveInstalledGeneralType, type CategoryPaths } from '../../../src/lib/categoryPaths';
import type { ModMetadata } from './metadata';
import { canonicalSupportedHeroName, supportedHeroNames } from './heroCodenames';
import { inferHeroesFromVpkPaths, invalidateVpkParseCache, parseVpkDirectoryCached } from './vpk';
import { inferHeroFromVpkTree } from './unknownModDetection';
import { classifyModPayload } from './modPayloadClassification';

export const MOD_HERO_DETECTION_VERSION = 3;

type DetectionMod = { size: number; installedAt: string };

function isHudMod(metadata: ModMetadata, paths?: CategoryPaths): boolean {
    if (metadata.globalTypeSource === 'manual' && metadata.globalType) return metadata.globalType === 'hud';
    if (!isLinked(metadata) && metadata.globalType) return metadata.globalType === 'hud';
    return (metadata.sourceSection ?? 'Mod') === 'Mod' && categoryGeneralType(resolveCategoryPath(paths, {
        id: metadata.categoryId, name: metadata.categoryName ?? '',
    })) === 'hud';
}

/** Only automatic root assignments can be refined from the payload. */
function isAutomaticModRoot(metadata: ModMetadata, roots: readonly string[], paths?: CategoryPaths): boolean {
    if ((metadata.sourceSection ?? 'Mod') !== 'Mod' || metadata.globalTypeSource === 'manual'
        || !isLinked(metadata) && metadata.globalType
        || metadata.lockerHeroSource === 'manual' && metadata.lockerHero?.trim()) return false;
    const path = resolveCategoryPath(paths, { id: metadata.categoryId, name: metadata.categoryName ?? '' });
    return path.length === 1 && roots.includes(path[0].name.toLowerCase());
}

function isBroadMod(metadata: ModMetadata, paths?: CategoryPaths): boolean {
    return isAutomaticModRoot(metadata, ['skins', 'model replacement'], paths);
}

function isHudRoot(metadata: ModMetadata, paths?: CategoryPaths): boolean {
    return isAutomaticModRoot(metadata, ['hud'], paths);
}

/** Sound, WiP, HUD, and broadly categorized Mod files share per-file caching. */
export function isModHeroDetectionEligible(metadata: ModMetadata | undefined, paths?: CategoryPaths): boolean {
    return !!metadata && (metadata.sourceSection === 'Sound' || metadata.sourceSection === 'Wip'
        || isHudMod(metadata, paths) || isBroadMod(metadata, paths));
}

type DetectionKind = 'tiered' | 'local' | 'broad' | 'hud-root';

function tieredDetectionKind(metadata: ModMetadata, paths?: CategoryPaths): DetectionKind {
    return isBroadMod(metadata, paths) ? 'broad' : isHudRoot(metadata, paths) ? 'hud-root' : 'tiered';
}

function detectionInputs(metadata: ModMetadata, kind: DetectionKind = 'tiered'): string {
    return JSON.stringify([
        kind,
        metadata.sourceSection,
        metadata.archiveVpkPath ?? '',
        metadata.sourceFileName ?? '',
        metadata.fileDescription ?? '',
        metadata.modName ?? '',
        ...(kind === 'broad' || kind === 'hud-root' ? [metadata.categoryId, metadata.categoryName] : []),
    ]);
}

function needsDetection(mod: DetectionMod, metadata: ModMetadata, kind: DetectionKind = 'tiered'): boolean {
    const previous = metadata.heroDetection;
    return !previous || previous.version !== MOD_HERO_DETECTION_VERSION
        || previous.size !== mod.size || previous.modifiedAt !== mod.installedAt
        || previous.inputs !== detectionInputs(metadata, kind);
}

function isLinked(metadata: ModMetadata): boolean {
    return typeof metadata.gameBananaId === 'number' && metadata.gameBananaId > 0;
}

/** Every payload fallback shares the existing worker-pool parse pre-warming. */
export function needsModHeroDetection(mod: DetectionMod, metadata: ModMetadata | undefined, paths?: CategoryPaths): boolean {
    const data = metadata ?? {};
    if (data.globalType && data.globalType !== 'hud' && (data.globalTypeSource === 'manual'
        || !isLinked(data) && !(data.lockerHeroSource === 'manual' && data.lockerHero?.trim()))) return false;
    if (data.lockerHeroSource === 'manual' && data.lockerHero?.trim()
        && !(data.globalTypeSource === 'manual' && data.globalType)) return false;
    const tiered = isModHeroDetectionEligible(data, paths);
    if (!tiered && data.globalTypeSource === 'manual') return false;
    if (!tiered && (isLinked(data) || data.lockerHero?.trim())) return false;
    return needsDetection(mod, data, tiered ? tieredDetectionKind(data, paths) : 'local');
}

const aliasesByHero = new Map(supportedHeroNames.map((name) => [name, new Set([name, name.replace(/\s+/g, '')])]));
for (const [name, aliases] of Object.entries(HERO_ALIASES)) {
    const canonical = canonicalSupportedHeroName(name);
    if (!canonical) continue;
    for (const alias of aliases) aliasesByHero.get(canonical)?.add(alias);
}
aliasesByHero.get('Doorman')?.add('The Doorman');
aliasesByHero.get('Mo & Krill')?.add('Mo and Krill');

function normalizeFileText(text: string): string {
    return text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const fileHeroPatterns = [...aliasesByHero].map(([name, aliases]) => ({
    name,
    pattern: new RegExp(`(?<!\\p{L})(?:${[...aliases].map(normalizeFileText).map(escapeRegex).join('|')})(?!\\p{L})`, 'iu'),
}));

/** Match every supported hero in a single level of authored metadata. */
export function heroesMentionedInFileText(texts: readonly string[]): string[] {
    const normalized = texts.map(normalizeFileText);
    return fileHeroPatterns.filter(({ pattern }) => normalized.some((text) => pattern.test(text)))
        .map(({ name }) => name).sort((a, b) => a.localeCompare(b));
}

/** Stop at the first matching level: paths, description, original filenames, name. */
export function detectModHeroes(
    mod: DetectionMod & { path: string },
    metadata: ModMetadata | undefined,
    categoryPaths?: CategoryPaths,
): InstalledHeroDetection | undefined {
    if (!metadata || !isModHeroDetectionEligible(metadata, categoryPaths)) return undefined;
    const kind = tieredDetectionKind(metadata, categoryPaths);
    const broad = kind === 'broad';
    if (!needsDetection(mod, metadata, kind)) return metadata.heroDetection;
    const paths = parseVpkDirectoryCached(mod.path);
    if (paths === null) {
        // A transient parse failure must not become a permanent checked result.
        invalidateVpkParseCache(mod.path);
        return undefined;
    }
    const candidate = broad || kind === 'hud-root' ? classifyModPayload(paths) : undefined;
    // HUD is also a broad root used by portrait packs. Refine pure multi-hero
    // art to Icons, retaining normal HUD attribution for functional HUD files.
    const payload = broad || candidate?.kind === 'general' && candidate.globalType === 'icons'
        ? candidate : undefined;
    let heroes = payload
        ? payload.kind === 'hero' ? [payload.hero] : []
        : inferHeroesFromVpkPaths(paths);
    let source: InstalledHeroDetection['source'] = 'vpk';
    if (heroes.length === 0 && (!payload || payload.kind === 'unknown')) {
        const textLevels: Array<{ source: InstalledHeroDetection['source']; texts: string[] }> = [
            { source: 'description', texts: [metadata.fileDescription ?? ''] },
            { source: 'file', texts: [metadata.archiveVpkPath ?? '', metadata.sourceFileName ?? ''] },
            { source: 'name', texts: [metadata.modName ?? ''] },
        ];
        for (const level of textLevels) {
            source = level.source;
            heroes = heroesMentionedInFileText(level.texts);
            if (heroes.length > 0) break;
        }
        // A broad skin category does not establish ownership of several heroes.
        if (broad && heroes.length > 1) heroes = [];
    }
    return {
        version: MOD_HERO_DETECTION_VERSION,
        heroes,
        source,
        ...(payload?.kind === 'general' ? { globalType: payload.globalType } : {}),
        size: mod.size,
        modifiedAt: mod.installedAt,
        inputs: detectionInputs(metadata, kind),
    };
}

function detectLocalHeroes(mod: DetectionMod & { path: string }, metadata: ModMetadata): InstalledHeroDetection | undefined {
    if (!needsDetection(mod, metadata, 'local')) return metadata.heroDetection;
    const paths = parseVpkDirectoryCached(mod.path);
    if (paths === null) {
        invalidateVpkParseCache(mod.path);
        return undefined;
    }
    const payload = classifyModPayload(paths);
    if (payload.kind !== 'unknown') {
        return {
            version: MOD_HERO_DETECTION_VERSION,
            heroes: payload.kind === 'hero' ? [payload.hero] : [],
            ...(payload.kind === 'general' ? { globalType: payload.globalType } : {}),
            source: 'vpk', size: mod.size, modifiedAt: mod.installedAt, inputs: detectionInputs(metadata, 'local'),
        };
    }
    let heroes: string[] = [];
    try {
        const guess = inferHeroFromVpkTree(mod.path);
        const hero = guess && guess.strongestSignal !== 'weak' ? canonicalSupportedHeroName(guess.name) : undefined;
        if (hero) heroes = [hero];
    } catch (error) {
        console.warn(`[mods] Local hero detection failed for ${mod.path}:`, error);
        invalidateVpkParseCache(mod.path);
        return undefined;
    }
    return {
        version: MOD_HERO_DETECTION_VERSION, heroes, source: 'vpk',
        size: mod.size, modifiedAt: mod.installedAt, inputs: detectionInputs(metadata, 'local'),
    };
}

export interface ResolvedModClassification {
    lockerHero?: string;
    lockerHeroSource?: LockerHeroSource;
    lockerHeroes: string[];
    globalType?: GlobalModType;
    metadataPatch?: Pick<ModMetadata, 'heroDetection'>;
}

/** Shared runtime identity for library display and per-file attribution. */
export function resolveModClassification(
    mod: DetectionMod & { path: string },
    metadata: ModMetadata | undefined,
    paths?: CategoryPaths,
): ResolvedModClassification {
    const data = metadata ?? {};
    const hud = isHudMod(data, paths);
    if (data.globalType && data.globalType !== 'hud' && (data.globalTypeSource === 'manual'
        || !isLinked(data) && !(data.lockerHeroSource === 'manual' && data.lockerHero?.trim()))) {
        return { lockerHeroes: [], globalType: data.globalType };
    }
    const tiered = isModHeroDetectionEligible(data, paths);
    const savedHero = data.globalTypeSource === 'manual' && data.globalType ? undefined : data.lockerHero?.trim();
    let lockerHero = savedHero && (data.lockerHeroSource === 'manual' || (!isLinked(data) && !tiered))
        ? canonicalSupportedHeroName(savedHero) ?? savedHero : undefined;
    let lockerHeroSource = lockerHero ? data.lockerHeroSource : undefined;
    let lockerHeroes = lockerHero ? [lockerHero] : [];
    let detection: InstalledHeroDetection | undefined;
    let checked = false;
    if (!lockerHero && tiered) {
        detection = detectModHeroes(mod, data, paths);
        checked = true;
        lockerHeroes = detection?.heroes ?? [];
    } else if (!lockerHero && (data.sourceSection ?? 'Mod') === 'Mod') {
        const path = resolveCategoryPath(paths, { id: data.categoryId, name: data.categoryName ?? '' });
        const categoryHero = categoryHeroName(path)
            ?? path.map(category => canonicalSupportedHeroName(category.name)).find(Boolean);
        if (categoryHero) lockerHeroes = [canonicalSupportedHeroName(categoryHero) ?? categoryHero];
    }
    if (!tiered && !isLinked(data) && lockerHeroes.length === 0 && data.globalTypeSource !== 'manual') {
        detection = detectLocalHeroes(mod, data);
        checked = true;
        lockerHeroes = detection?.heroes ?? [];
        lockerHero = lockerHeroes[0];
        lockerHeroSource = lockerHero ? 'vpk' : undefined;
    }
    const iconPack = isHudRoot(data, paths) && detection?.globalType === 'icons';
    const globalType = iconPack ? 'icons'
        : resolveInstalledGeneralType(data, paths, hud ? [] : lockerHeroes) ?? detection?.globalType;
    if (globalType) {
        lockerHero = undefined;
        lockerHeroSource = undefined;
        if (globalType !== 'hud') lockerHeroes = [];
    } else if (tiered && !hud && !lockerHero && lockerHeroes.length === 1) {
        // Preserve the existing single-hero API without persisting automatic tags.
        lockerHero = lockerHeroes[0];
        lockerHeroSource = detection?.source === 'vpk' ? 'vpk' : undefined;
    }
    const metadataPatch = checked && detection !== data.heroDetection && (detection || data.heroDetection)
        ? { heroDetection: detection } : undefined;
    return { lockerHero, lockerHeroSource, lockerHeroes, globalType, ...(metadataPatch ? { metadataPatch } : {}) };
}
