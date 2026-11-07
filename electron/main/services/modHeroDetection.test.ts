import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModMetadata } from './metadata';
import {
    detectModHeroes,
    heroesMentionedInFileText,
    needsModHeroDetection,
    resolveModClassification,
    isModHeroDetectionEligible,
} from './modHeroDetection';
import { buildCategoryPaths } from '../../../src/lib/categoryPaths';

const parser = vi.hoisted(() => ({
    read: vi.fn<() => string[] | null>(),
    invalidate: vi.fn(),
    localHero: vi.fn(),
}));

vi.mock('./vpk', async (original) => ({
    ...await original<typeof import('./vpk')>(),
    parseVpkDirectoryCached: parser.read,
    invalidateVpkParseCache: parser.invalidate,
}));
vi.mock('./unknownModDetection', () => ({ inferHeroFromVpkTree: parser.localHero }));

const mod = { path: 'installed/silver_from_submission_title_dir.vpk', size: 123, installedAt: '2026-10-26T12:00:00.000Z' };

beforeEach(() => {
    vi.clearAllMocks();
    parser.read.mockReturnValue([]);
    parser.localHero.mockReturnValue(null);
});

describe('installed hero detection', () => {
    it.each(['Sound', 'Wip'])('detects every payload hero before contradictory %s file labels', (sourceSection) => {
        parser.read.mockReturnValue([
            'sounds/vo/atlas/line.vsnd_c',
            'sounds/vo/chessmaster/line.vsnd_c',
        ]);
        const metadata: ModMetadata = { sourceSection, sourceFileName: 'haze.zip', fileDescription: 'Wraith', modName: 'Rem' };
        expect(detectModHeroes(mod, metadata)).toMatchObject({ heroes: ['Abrams', 'Solomon'], source: 'vpk' });
    });

    it('prefers all per-file description matches over original filenames and the submission name', () => {
        parser.read.mockReturnValue(['sounds/vo/shopkeeper/line.vsnd_c']);
        const metadata: ModMetadata = {
            sourceSection: 'Sound',
            sourceFileName: 'galaxy_rem_gold',
            archiveVpkPath: 'Lady_Geist/voice_dir.vpk',
            fileDescription: 'For Mo and Krill and Ivy',
            modName: 'Haze',
        };
        expect(detectModHeroes(mod, metadata)).toMatchObject({
            heroes: ['Ivy', 'Mo & Krill'], source: 'description',
        });
    });

    it.each([undefined, '', 'General voice changes'])('uses original filenames when description %s has no hero match', (fileDescription) => {
        const metadata: ModMetadata = {
            sourceSection: 'Sound', sourceFileName: 'galaxy_rem_gold',
            archiveVpkPath: 'Lady_Geist/voice_dir.vpk', fileDescription, modName: 'Haze',
        };
        expect(detectModHeroes(mod, metadata)).toMatchObject({ heroes: ['Lady Geist', 'Rem'], source: 'file' });
    });

    it('uses every name match only after the earlier levels found no hero', () => {
        const metadata: ModMetadata = { sourceSection: 'Wip', modName: 'Haze and Silver', sourceFileName: 'pak01' };
        expect(detectModHeroes(mod, metadata)).toMatchObject({ heroes: ['Haze', 'Silver'], source: 'name' });
    });

    it('never treats a generated installed filename as an original filename or mod name', () => {
        const metadata: ModMetadata = { sourceSection: 'Wip', modName: 'Voice changes', sourceFileName: 'pak01' };
        const result = detectModHeroes(mod, metadata);
        expect(result).toMatchObject({ heroes: [], source: 'name' });
        expect(needsModHeroDetection(mod, { ...metadata, heroDetection: result })).toBe(false);
    });

    it('reuses a successful empty detection until its payload or original labels change', () => {
        const metadata: ModMetadata = { sourceSection: 'Sound', sourceFileName: 'unknown' };
        const result = detectModHeroes(mod, metadata);
        const cached = { ...metadata, heroDetection: result };
        parser.read.mockClear();
        expect(detectModHeroes(mod, cached)).toBe(result);
        expect(parser.read).not.toHaveBeenCalled();
        expect(needsModHeroDetection({ ...mod, size: 124 }, cached)).toBe(true);
        expect(needsModHeroDetection({ ...mod, installedAt: '2026-10-27T12:00:00.000Z' }, cached)).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, fileDescription: 'Rem' })).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, modName: 'Rem' })).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, sourceSection: 'Wip' })).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, heroDetection: { ...result!, version: -1 } })).toBe(true);
    });

    it('rechecks an updated VPK payload instead of retaining its predecessor matches', () => {
        const metadata: ModMetadata = { sourceSection: 'Sound', modName: 'Voice changes' };
        parser.read.mockReturnValueOnce(['sounds/vo/haze/line.vsnd_c']);
        const previous = detectModHeroes(mod, metadata);
        parser.read.mockReturnValueOnce(['sounds/vo/familiar/line.vsnd_c']);
        expect(detectModHeroes({ ...mod, size: mod.size + 1 }, { ...metadata, heroDetection: previous }))
            .toMatchObject({ heroes: ['Rem'], source: 'vpk' });
    });

    it('leaves parse failures retryable instead of freezing a textual guess', () => {
        parser.read.mockReturnValueOnce(null);
        const metadata: ModMetadata = { sourceSection: 'Sound', fileDescription: 'Rem' };
        expect(detectModHeroes(mod, metadata)).toBeUndefined();
        expect(parser.invalidate).toHaveBeenCalledWith(mod.path);
        parser.read.mockReturnValueOnce(['sounds/abilities/chrono/a4_ult/sound.vsnd_c']);
        expect(detectModHeroes(mod, metadata)).toMatchObject({ heroes: ['Paradox'], source: 'vpk' });
    });

    it.each(['Mod', undefined])('does not inspect non-Sound/WiP payloads (%s)', (sourceSection) => {
        const metadata = { sourceSection };
        expect(needsModHeroDetection(mod, metadata)).toBe(true);
        expect(detectModHeroes(mod, metadata)).toBeUndefined();
        expect(parser.read).not.toHaveBeenCalled();
    });
});

describe('shared installed classification', () => {
    it('recognizes a named custom local skin and reuses its payload-specific cache', () => {
        parser.localHero.mockReturnValue({ name: 'Ivy', strongestSignal: 'medium' });
        const metadata: ModMetadata = { modName: 'Custom outfit' };
        const result = resolveModClassification(mod, metadata);
        expect(result).toMatchObject({ lockerHero: 'Ivy', lockerHeroSource: 'vpk', lockerHeroes: ['Ivy'] });
        expect(result.metadataPatch?.heroDetection?.source).toBe('vpk');
        parser.localHero.mockClear();
        parser.read.mockClear();
        const cached = { ...metadata, ...result.metadataPatch };
        expect(needsModHeroDetection(mod, cached)).toBe(false);
        expect(resolveModClassification(mod, cached).lockerHeroes).toEqual(['Ivy']);
        expect(parser.localHero).not.toHaveBeenCalled();
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('caches successful weak/no-hero local checks and retries unreadable payloads', () => {
        parser.localHero.mockReturnValue({ name: 'Ivy', strongestSignal: 'weak' });
        const metadata: ModMetadata = { modName: 'Local file' };
        const result = resolveModClassification(mod, metadata);
        expect(result.lockerHeroes).toEqual([]);
        expect(result.metadataPatch?.heroDetection?.heroes).toEqual([]);
        expect(needsModHeroDetection(mod, { ...metadata, ...result.metadataPatch })).toBe(false);
        parser.read.mockReturnValueOnce(null);
        expect(resolveModClassification({ ...mod, size: 124 }, { ...metadata, ...result.metadataPatch }))
            .toMatchObject({ lockerHeroes: [], metadataPatch: { heroDetection: undefined } });
        expect(parser.invalidate).toHaveBeenCalledWith(mod.path);
    });

    it('preserves explicit local hero choices ahead of legacy General values', () => {
        const metadata: ModMetadata = { globalType: 'hud', lockerHero: 'The Doorman', lockerHeroSource: 'manual' };
        expect(resolveModClassification(mod, metadata)).toMatchObject({ lockerHeroes: ['Doorman'], globalType: undefined });
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('keeps explicit General overrides and legacy local General classifications off the hero axis', () => {
        expect(resolveModClassification(mod, { globalType: 'effects', lockerHero: 'Ivy', lockerHeroSource: 'vpk' }))
            .toEqual({ lockerHeroes: [], globalType: 'effects' });
        expect(resolveModClassification(mod, { sourceSection: 'Wip', globalType: 'effects', globalTypeSource: 'manual',
            lockerHero: 'Ivy', lockerHeroSource: 'manual' })).toEqual({ lockerHeroes: [], globalType: 'effects' });
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('retains a manual unassigned General choice without suppressing the explicit hero', () => {
        expect(resolveModClassification(mod, { globalType: null, globalTypeSource: 'manual',
            lockerHero: 'Ivy', lockerHeroSource: 'manual' })).toMatchObject({ lockerHeroes: ['Ivy'], globalType: undefined });
    });

    it('resolves current category ancestry and ignores obsolete automatic tags on linked mods', () => {
        const paths = buildCategoryPaths([{ id: 1, name: 'Skins', itemCount: 0,
            children: [{ id: 2, name: 'Future Hero', itemCount: 0 }] }]);
        expect(resolveModClassification(mod, { gameBananaId: 7, categoryId: 2, globalType: 'hud',
            lockerHero: 'Haze', lockerHeroSource: 'title' }, paths))
            .toMatchObject({ lockerHeroes: ['Future Hero'], lockerHero: undefined, globalType: undefined });
        expect(parser.read).not.toHaveBeenCalled();
    });

    it.each(['Skins > Ivy', 'Skins / Ivy'])('restores offline breadcrumb hero %s without title guessing', (categoryName) => {
        expect(resolveModClassification(mod, { gameBananaId: 7, categoryName }))
            .toMatchObject({ lockerHeroes: ['Ivy'], globalType: undefined });
    });
});

it.each(['Sound', 'Wip'])('keeps existing single-hero consumers compatible with resolved %s tags', (sourceSection) => {
    const metadata: ModMetadata = { sourceSection, fileDescription: 'Haze' };
    const single = resolveModClassification(mod, metadata);
    expect(single).toMatchObject({ lockerHero: 'Haze', lockerHeroes: ['Haze'] });
    expect(single.metadataPatch).not.toHaveProperty('lockerHero');
    expect(metadata).not.toHaveProperty('lockerHero');

    const multiple = resolveModClassification(mod, { ...metadata, fileDescription: 'Haze and Wraith' });
    expect(multiple.lockerHeroes).toEqual(['Haze', 'Wraith']);
    expect(multiple.lockerHero).toBeUndefined();
});

describe('HUD hero attribution', () => {
    const hudPaths = buildCategoryPaths([{ id: 10, name: 'HUD', itemCount: 0,
        children: [{ id: 11, name: 'Character widgets', itemCount: 0,
            children: [{ id: 12, name: 'Custom portraits', itemCount: 0 }] }] }]);
    const metadata: ModMetadata = { gameBananaId: 7, sourceSection: 'Mod', categoryId: 12,
        categoryName: 'Custom portraits', fileDescription: 'Baba', sourceFileName: 'rem_widgets', modName: 'Haze theme' };

    it('uses cached HUD ancestry to detect every payload hero while preserving General routing', () => {
        parser.read.mockReturnValue(['panorama/images/heroes/ghost_card_psd.vtex_c', 'panorama/images/heroes/tengu_card_psd.vtex_c']);
        expect(isModHeroDetectionEligible(metadata, hudPaths)).toBe(true);
        expect(needsModHeroDetection(mod, metadata, hudPaths)).toBe(true);
        const result = resolveModClassification(mod, metadata, hudPaths);
        expect(result).toMatchObject({ globalType: 'hud', lockerHeroes: ['Ivy', 'Lady Geist'], lockerHero: undefined });
        expect(result.metadataPatch?.heroDetection).toMatchObject({ heroes: ['Ivy', 'Lady Geist'], source: 'vpk' });
        expect(result.metadataPatch).not.toHaveProperty('lockerHero');
        expect(result.metadataPatch).not.toHaveProperty('globalType');
        expect(needsModHeroDetection(mod, { ...metadata, ...result.metadataPatch }, hudPaths)).toBe(false);
    });

    it('applies description, original filename, and name fallbacks in the same strict order', () => {
        expect(detectModHeroes(mod, metadata, hudPaths)).toMatchObject({ heroes: ['Baba'], source: 'description' });
        expect(detectModHeroes(mod, { ...metadata, fileDescription: '' }, hudPaths))
            .toMatchObject({ heroes: ['Rem'], source: 'file' });
        expect(detectModHeroes(mod, { ...metadata, fileDescription: '', sourceFileName: 'widgets' }, hudPaths))
            .toMatchObject({ heroes: ['Haze'], source: 'name' });
    });

    it.each(['HUD', 'HUD > Custom portraits'])('falls back to saved HUD label %s without a tree', categoryName => {
        const result = resolveModClassification(mod, { ...metadata, categoryId: undefined, categoryName });
        expect(result).toMatchObject({ globalType: 'hud', lockerHeroes: ['Baba'], lockerHero: undefined });
    });

    it('supports preserved local HUD classifications without reviving an old automatic hero tag', () => {
        const local = { globalType: 'hud' as const, lockerHero: 'Haze', lockerHeroSource: 'vpk' as const, fileDescription: 'Ivy' };
        expect(resolveModClassification(mod, local)).toMatchObject({ globalType: 'hud', lockerHeroes: ['Ivy'], lockerHero: undefined });
        expect(resolveModClassification(mod, { ...local, globalTypeSource: 'manual' }))
            .toMatchObject({ globalType: 'hud', lockerHeroes: ['Ivy'], lockerHero: undefined });
    });

    it('preserves manual hero rerouting and explicit General choices', () => {
        expect(resolveModClassification(mod, { ...metadata, lockerHero: 'Ivy', lockerHeroSource: 'manual' }, hudPaths))
            .toMatchObject({ globalType: undefined, lockerHeroes: ['Ivy'], lockerHero: 'Ivy' });
        expect(resolveModClassification(mod, { ...metadata, globalType: 'effects', globalTypeSource: 'manual' }, hudPaths))
            .toEqual({ globalType: 'effects', lockerHeroes: [] });
        expect(resolveModClassification(mod, { ...metadata, globalType: null, globalTypeSource: 'manual' }, hudPaths))
            .toMatchObject({ globalType: undefined, lockerHeroes: ['Baba'], lockerHero: undefined });
    });

    it('detects HUD icons from the payload when explicit General overrides a stale manual hero', () => {
        const explicitHud = { ...metadata, globalType: 'hud' as const, globalTypeSource: 'manual' as const,
            lockerHero: 'Ivy', lockerHeroSource: 'manual' as const };
        parser.read.mockReturnValue(['panorama/images/heroes/wraith_card_psd.vtex_c']);
        expect(needsModHeroDetection(mod, explicitHud, hudPaths)).toBe(true);
        expect(resolveModClassification(mod, explicitHud, hudPaths))
            .toMatchObject({ globalType: 'hud', lockerHeroes: ['Wraith'], lockerHero: undefined });
    });

    it('does not detect a non-HUD Mod or guess an absent HUD ancestor from a leaf name', () => {
        const otherPaths = buildCategoryPaths([{ id: 20, name: 'Other/Misc', itemCount: 0,
            children: [{ id: 12, name: 'Character HUD', itemCount: 0 }] }]);
        expect(isModHeroDetectionEligible(metadata, otherPaths)).toBe(false);
        expect(detectModHeroes(mod, metadata, otherPaths)).toBeUndefined();
        expect(parser.read).not.toHaveBeenCalled();
    });
});

describe('original file text matching', () => {
    it('matches supported names and aliases with filename separators', () => {
        expect(heroesMentionedInFileText(['mo_and_krill', 'The-Doorman', 'ratking_voice', 'grey_talon_gold']))
            .toEqual(['Doorman', 'Grey Talon', 'Mo & Krill', 'Rat King']);
    });

    it('rejects substrings, unsupported heroes, and NPC labels', () => {
        expect(heroesMentionedInFileText(['Remodel Silverhand Hazelnut', 'Fathom Kali Trapper', 'shopkeeper neutral_gremlin']))
            .toEqual([]);
    });
});

describe('HUD-root portrait packs', () => {
    const metadata: ModMetadata = { gameBananaId: 610813, sourceSection: 'Mod', categoryId: 31713,
        categoryName: 'HUD', modName: 'DEADLOCK TOASTED' };
    const portraits = ['panorama/images/heroes/yamato_card_psd.vtex_c',
        'panorama/images/heroes/haze_card_psd.vtex_c', 'panorama/images/npcs/patron_psd.vtex_c'];
    const tree = buildCategoryPaths([{ id: 31713, name: 'HUD', itemCount: 1,
        children: [{ id: 44745, name: 'Character HUD', itemCount: 1 }] }]);

    it.each([undefined, tree])('refines the HUD root to Icons with cached ancestry or offline labels', paths => {
        parser.read.mockReturnValue(portraits);
        const result = resolveModClassification(mod, metadata, paths);
        expect(result).toMatchObject({ globalType: 'icons', lockerHeroes: [], lockerHero: undefined });
        expect(result.metadataPatch).toEqual({ heroDetection: expect.objectContaining({
            source: 'vpk', heroes: [], globalType: 'icons',
        }) });
        expect(metadata.categoryName).toBe('HUD');
        const cached = { ...metadata, ...result.metadataPatch };
        parser.read.mockClear();
        expect(needsModHeroDetection(mod, cached, paths)).toBe(false);
        expect(resolveModClassification(mod, cached, paths).globalType).toBe('icons');
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('rechecks the previous detector result rather than retaining its HUD hero list', () => {
        parser.read.mockReturnValue(portraits);
        const previous = detectModHeroes(mod, metadata)!;
        const cached = { ...metadata, heroDetection: { ...previous, version: 2,
            globalType: undefined, heroes: ['Haze', 'Yamato'] } };
        expect(needsModHeroDetection(mod, cached, tree)).toBe(true);
        expect(resolveModClassification(mod, cached, tree)).toMatchObject({ globalType: 'icons', lockerHeroes: [] });
    });

    it('keeps a functional HUD containing portraits on HUD', () => {
        parser.read.mockReturnValue([...portraits, 'panorama/layout/hud/custom.vxml_c']);
        expect(resolveModClassification(mod, metadata, tree))
            .toMatchObject({ globalType: 'hud', lockerHeroes: ['Haze', 'Yamato'] });
    });

    it('does not carry a root refinement into a specific HUD child', () => {
        parser.read.mockReturnValue(portraits);
        const cached = { ...metadata, ...resolveModClassification(mod, metadata, tree).metadataPatch,
            categoryId: 44745, categoryName: 'Character HUD' };
        expect(needsModHeroDetection(mod, cached, tree)).toBe(true);
        expect(resolveModClassification(mod, cached, tree))
            .toMatchObject({ globalType: 'hud', lockerHeroes: ['Haze', 'Yamato'] });
    });

    it('keeps manual HUD, hero, and unassigned choices ahead of a cached Icons result', () => {
        parser.read.mockReturnValue(portraits);
        const cached = { ...metadata, ...resolveModClassification(mod, metadata, tree).metadataPatch };
        expect(resolveModClassification(mod, { ...cached, globalType: 'hud', globalTypeSource: 'manual' }, tree))
            .toMatchObject({ globalType: 'hud', lockerHeroes: ['Haze', 'Yamato'] });
        expect(resolveModClassification(mod, { ...cached, lockerHero: 'Ivy', lockerHeroSource: 'manual' }, tree))
            .toMatchObject({ globalType: undefined, lockerHeroes: ['Ivy'] });
        expect(resolveModClassification(mod, { ...cached, globalType: null, globalTypeSource: 'manual' }, tree).globalType)
            .toBeUndefined();
    });
});

describe('broad category payload fallback', () => {
    const metadata: ModMetadata = { gameBananaId: 7, sourceSection: 'Mod', categoryId: 33154,
        categoryName: 'Model Replacement', modName: 'Freaky Hidout' };

    it('assigns a root-filed Hideout texture mod without rewriting its category', () => {
        parser.read.mockReturnValue(['models/hideout/materials/display.vtex_c']);
        expect(isModHeroDetectionEligible(metadata)).toBe(true);
        expect(needsModHeroDetection(mod, metadata)).toBe(true);
        const result = resolveModClassification(mod, metadata);
        expect(result).toMatchObject({ lockerHeroes: [], globalType: 'hideout' });
        expect(result.metadataPatch).toEqual({ heroDetection: expect.objectContaining({
            heroes: [], globalType: 'hideout', source: 'vpk',
        }) });
        expect(metadata.categoryName).toBe('Model Replacement');
    });

    it.each([
        ['Skins', 'models/heroes_wip/vampirebat/vampirebat.vmdl_c', 'Mina'],
        ['Model Replacement', 'particles/abilities/hornet/tracer.vpcf_c', 'Vindicta'],
    ])('uses a payload hero for a skin filed directly under %s', (categoryName, path, hero) => {
        parser.read.mockReturnValue([path]);
        const result = resolveModClassification(mod, { ...metadata, categoryName, modName: 'Haze' });
        expect(result).toMatchObject({ lockerHero: hero, lockerHeroes: [hero], lockerHeroSource: 'vpk', globalType: undefined });
        expect(result.metadataPatch?.heroDetection).toMatchObject({ heroes: [hero], source: 'vpk' });
    });

    it('reuses and invalidates the General fallback cache with the payload and inputs', () => {
        parser.read.mockReturnValue(['models/hideout/materials/display.vtex_c']);
        const result = resolveModClassification(mod, metadata);
        const cached = { ...metadata, ...result.metadataPatch };
        parser.read.mockClear();
        expect(needsModHeroDetection(mod, cached)).toBe(false);
        expect(resolveModClassification(mod, cached).globalType).toBe('hideout');
        expect(parser.read).not.toHaveBeenCalled();
        expect(needsModHeroDetection({ ...mod, size: 124 }, cached)).toBe(true);
        expect(needsModHeroDetection({ ...mod, installedAt: 'changed' }, cached)).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, sourceFileName: 'changed' })).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, categoryName: 'Skins' })).toBe(true);
        expect(needsModHeroDetection(mod, { ...cached, heroDetection: { ...cached.heroDetection!, version: 1 } })).toBe(true);
        parser.read.mockReturnValue(['models/heroes_wip/haze/body.vmdl_c']);
        expect(resolveModClassification({ ...mod, size: 124 }, cached))
            .toMatchObject({ lockerHeroes: ['Haze'], globalType: undefined });
    });

    it('uses specific ancestry even when an older broad-category cache exists', () => {
        parser.read.mockReturnValue(['models/hideout/materials/display.vtex_c']);
        const cached = { ...metadata, ...resolveModClassification(mod, metadata).metadataPatch };
        const paths = buildCategoryPaths([{ id: 1, name: 'Skins', itemCount: 0,
            children: [{ id: 33154, name: 'Ivy', itemCount: 0 }] }]);
        parser.read.mockClear();
        expect(needsModHeroDetection(mod, cached, paths)).toBe(false);
        expect(resolveModClassification(mod, cached, paths)).toMatchObject({ lockerHeroes: ['Ivy'], globalType: undefined });
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('uses description, original filename, then title only without decisive paths', () => {
        const labels = { ...metadata, fileDescription: 'Mina red version', sourceFileName: 'vindicta.zip', modName: 'Haze' };
        expect(detectModHeroes(mod, labels)).toMatchObject({ heroes: ['Mina'], source: 'description' });
        expect(detectModHeroes(mod, { ...labels, fileDescription: '' })).toMatchObject({ heroes: ['Vindicta'], source: 'file' });
        expect(detectModHeroes(mod, { ...labels, fileDescription: '', sourceFileName: '' })).toMatchObject({ heroes: ['Haze'], source: 'name' });
        expect(detectModHeroes(mod, { ...labels, fileDescription: 'Mina and Vindicta' })).toMatchObject({ heroes: [], source: 'description' });
    });

    it('does not replace ambiguous paths with a title guess and caches that outcome', () => {
        parser.read.mockReturnValue(['models/heroes_wip/haze/body.vmdl_c', 'models/heroes_wip/wraith/body.vmdl_c']);
        const named = { ...metadata, modName: 'Mina' };
        const result = resolveModClassification(mod, named);
        expect(result).toMatchObject({ lockerHeroes: [], globalType: undefined });
        expect(needsModHeroDetection(mod, { ...named, ...result.metadataPatch })).toBe(false);
    });

    it('retries an unreadable VPK instead of keeping an old General assignment', () => {
        parser.read.mockReturnValue(['models/hideout/materials/display.vtex_c']);
        const cached = { ...metadata, ...resolveModClassification(mod, metadata).metadataPatch };
        parser.read.mockReturnValue(null);
        expect(resolveModClassification({ ...mod, size: 124 }, cached))
            .toMatchObject({ lockerHeroes: [], globalType: undefined, metadataPatch: { heroDetection: undefined } });
        expect(parser.invalidate).toHaveBeenCalledWith(mod.path);
    });

    it('preserves manual hero, General, and explicitly unassigned choices over cached inference', () => {
        parser.read.mockReturnValue(['models/hideout/materials/display.vtex_c']);
        const cached = { ...metadata, ...resolveModClassification(mod, metadata).metadataPatch };
        parser.read.mockClear();
        expect(resolveModClassification(mod, { ...cached, lockerHero: 'Ivy', lockerHeroSource: 'manual' }))
            .toMatchObject({ lockerHeroes: ['Ivy'], globalType: undefined });
        expect(resolveModClassification(mod, { ...cached, globalType: 'effects', globalTypeSource: 'manual' }))
            .toEqual({ lockerHeroes: [], globalType: 'effects' });
        const unassigned = { ...cached, globalType: null, globalTypeSource: 'manual' as const };
        expect(resolveModClassification(mod, unassigned)).toMatchObject({ lockerHeroes: [], globalType: undefined });
        expect(needsModHeroDetection(mod, unassigned)).toBe(false);
        expect(parser.read).not.toHaveBeenCalled();
    });

    it.each(['Quality of Life/Fixes', 'Gameplay Modifications', 'Accessibility', 'Other/Misc', 'Hideout'])(
        'does not apply the broad-category fallback to %s', categoryName => {
            expect(needsModHeroDetection(mod, { ...metadata, categoryName })).toBe(false);
            const result = resolveModClassification(mod, { ...metadata, categoryName, modName: 'Haze' });
            expect(result.lockerHeroes).toEqual([]);
            expect(result.globalType).toBe(categoryName === 'Hideout' ? 'hideout' : undefined);
            expect(parser.read).not.toHaveBeenCalled();
        },
    );

    it.each([undefined, 7])('routes multi-hero portrait packs for local or linked files (%s)', gameBananaId => {
        parser.read.mockReturnValue(['panorama/images/heroes/haze_card_psd.vtex_c', 'panorama/images/heroes/wraith_card_psd.vtex_c']);
        expect(resolveModClassification(mod, { gameBananaId, ...(gameBananaId ? metadata : {}) }))
            .toMatchObject({ lockerHeroes: [], globalType: 'icons' });
    });

    it('honors explicitly unassigned local files without running a path fallback', () => {
        const local: ModMetadata = { globalType: null, globalTypeSource: 'manual' };
        expect(needsModHeroDetection(mod, local)).toBe(false);
        expect(resolveModClassification(mod, local)).toMatchObject({ lockerHeroes: [], globalType: undefined });
        expect(parser.read).not.toHaveBeenCalled();
    });
});
