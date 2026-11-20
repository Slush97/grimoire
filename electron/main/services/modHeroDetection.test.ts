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
    it('overlays tag selections without changing original categories or detected heroes', () => {
        const metadata = { gameBananaId: 10, categoryName: 'Skins > Ivy', abilitySounds: null };
        expect(resolveModClassification(mod, metadata).lockerHeroes).toEqual(['Ivy']);
        expect(resolveModClassification(mod, { ...metadata, tagOverrides: { base: [], heroes: [] } }))
            .toMatchObject({ lockerHeroes: [], globalType: undefined, lockerHero: undefined });
        expect(resolveModClassification(mod, { ...metadata, tagOverrides: { base: ['HUD'], heroes: ['Haze', 'Wraith'] } }))
            .toMatchObject({ lockerHeroes: ['Haze', 'Wraith'], globalType: 'hud', detectedTags: { heroes: ['Ivy'], globalType: undefined } });
        expect(resolveModClassification(mod, { ...metadata, tagOverrides: { base: ['HUD'] } }).lockerHeroes).toEqual(['Ivy']);
        expect(resolveModClassification(mod, metadata).lockerHeroes).toEqual(['Ivy']);
        expect(metadata.categoryName).toBe('Skins > Ivy');
    });

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

describe('skins without an assigned hero category', () => {
    const paths = buildCategoryPaths([{ id: 1, name: 'Skins', itemCount: 0, children: [{ id: 2, name: 'Ivy', itemCount: 0 }] }]);
    const skin: ModMetadata = { gameBananaId: 7, sourceSection: 'Mod', categoryId: 1, categoryName: 'Skins' };

    it.each([
        { fileDescription: 'Haze and Ivy variants', sourceFileName: 'Wraith', modName: 'Rem', heroes: ['Haze', 'Ivy'], source: 'description' },
        { fileDescription: 'Golden outfit', sourceFileName: 'Lady_Geist-gold', modName: 'Rem', heroes: ['Lady Geist'], source: 'file' },
        { fileDescription: '', sourceFileName: 'gold', modName: 'Haze and Wraith outfits', heroes: ['Haze', 'Wraith'], source: 'name' },
        { fileDescription: '', sourceFileName: 'gold', modName: 'Generic outfit', heroes: [], source: 'name' },
    ])('uses $source matching without parsing the payload: $modName', ({ heroes, source, ...labels }) => {
        parser.read.mockReturnValue(null);
        const metadata = { ...skin, ...labels };
        expect(isModHeroDetectionEligible(metadata, paths)).toBe(true);
        expect(needsModHeroDetection(mod, metadata, paths)).toBe(false);
        expect(detectModHeroes(mod, metadata, paths)).toMatchObject({ heroes, source });
        expect(resolveModClassification(mod, metadata, paths).lockerHeroes).toEqual(heroes);
        expect(parser.read).toHaveBeenCalledTimes(heroes.length ? 0 : 1);
        expect(parser.localHero).not.toHaveBeenCalled();
    });

    it('works offline and refreshes cached text matches when the original labels change', () => {
        const metadata = { ...skin, modName: 'Haze outfit' };
        const previous = detectModHeroes(mod, metadata);
        expect(detectModHeroes(mod, { ...metadata, heroDetection: previous })).toBe(previous);
        expect(detectModHeroes(mod, { ...metadata, heroDetection: previous, fileDescription: 'Ivy variant' }))
            .toMatchObject({ heroes: ['Ivy'], source: 'description' });
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('keeps explicit hero categories and manual assignments ahead of textual matches', () => {
        const categorized = { ...skin, categoryId: 2, categoryName: 'Ivy', modName: 'Haze outfit' };
        expect(isModHeroDetectionEligible(categorized, paths)).toBe(false);
        expect(resolveModClassification(mod, categorized, paths).lockerHeroes).toEqual(['Ivy']);
        expect(resolveModClassification(mod, { ...skin, modName: 'Haze outfit', lockerHero: 'Wraith', lockerHeroSource: 'manual' }, paths))
            .toMatchObject({ lockerHero: 'Wraith', lockerHeroes: ['Wraith'] });
        expect(parser.read).not.toHaveBeenCalled();
    });

    it('does not reuse text-only results when a mod becomes eligible for payload detection', () => {
        const previous = detectModHeroes(mod, { ...skin, modName: 'Haze outfit' });
        parser.read.mockReturnValue(['sounds/vo/wraith/line.vsnd_c']);
        expect(detectModHeroes(mod, { ...skin, categoryId: undefined, categoryName: 'HUD', heroDetection: previous }))
            .toMatchObject({ heroes: ['Wraith'], source: 'vpk' });
        expect(parser.read).toHaveBeenCalledOnce();
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

describe('General prop classification', () => {
    it('keeps mixed local prop packs classified across cached scans', () => {
        parser.read.mockReturnValue([
            'materials/models/npc/patron_amber/color.vtex_c',
            'models/props_gameplay/sinners_sacrifice_vault/sinners_sacrifice.vmdl_c',
        ]);
        const result = resolveModClassification(mod, {});
        expect(result).toMatchObject({ globalType: 'hidden-king', propTypes: ['hidden-king', 'sinner'], lockerHeroes: [] });
        parser.read.mockClear();
        const cached = resolveModClassification(mod, { ...result.metadataPatch });
        expect(cached.propTypes).toEqual(['hidden-king', 'sinner']);
        expect(parser.read).not.toHaveBeenCalled();
    });
    it('leaves breakables in Other and respects explicit classifications', () => {
        parser.read.mockReturnValue(['models/items/item_crate.vmdl_c']);
        expect(resolveModClassification(mod, { gameBananaId: 123, categoryName: 'Other/Misc' }))
            .toMatchObject({ lockerHeroes: [] });
        expect(resolveModClassification(mod, { gameBananaId: 123, categoryName: 'Boxes' }).globalType).toBeUndefined();
        expect(resolveModClassification(mod, { globalType: 'hud', globalTypeSource: 'manual' }).globalType).toBe('hud');
    });
});

describe('asset-only Other fallback', () => {
    const linked = { gameBananaId: 999, categoryName: 'Other/Misc' };
    it('never scans known hero or non-prop General assignments just to look for props', () => {
        resolveModClassification(mod, { globalType: 'effects', globalTypeSource: 'manual' });
        resolveModClassification(mod, { ...linked, tagOverrides: { heroes: ['Ivy'] } });
        expect(parser.read).not.toHaveBeenCalled();
    });
    it('caches negative results and refuses category or user-tag lookalikes', () => {
        const data = { ...linked, categoryName: 'Patrons', tagOverrides: { base: ['Patrons'], heroes: [] } };
        const result = resolveModClassification(mod, data);
        expect(result.globalType).toBeUndefined(); expect(result.propTypes).toBeUndefined();
        expect(result.metadataPatch?.propDetection?.types).toEqual([]);
        parser.read.mockClear();
        resolveModClassification(mod, { ...data, ...result.metadataPatch });
        expect(parser.read).not.toHaveBeenCalled();
    });
    it('keeps detected membership through tag removal, but rechecks changed content', () => {
        parser.read.mockReturnValue(['materials/models/props_gameplay/soul_container/soul_container_color.vtex_c']);
        const result = resolveModClassification(mod, linked);
        expect(result.propTypes).toEqual(['soul-container']);
        const data = { ...linked, ...result.metadataPatch, tagOverrides: { base: [] } };
        parser.read.mockClear();
        expect(resolveModClassification(mod, data).propTypes).toEqual(['soul-container']);
        expect(parser.read).not.toHaveBeenCalled();
        parser.read.mockReturnValue([]);
        expect(resolveModClassification({ ...mod, size: mod.size + 1 }, data).propTypes).toBeUndefined();
        expect(parser.read).toHaveBeenCalledOnce();
    });
    it('does not permanently cache an unreadable VPK as having no props', () => {
        parser.read.mockReturnValue(null);
        expect(resolveModClassification(mod, linked).metadataPatch?.propDetection).toBeUndefined();
        parser.read.mockReturnValue(['models/props_gameplay/idol_urn/idol_urn.vmdl_c']);
        expect(resolveModClassification(mod, linked).propTypes).toEqual(['spirit-urn']);
    });
});

it('reclassifies legacy patron detections into both exact slots and discards Boxes evidence', () => {
    parser.read.mockReturnValue(['models/npc/patron_amber/patron_amber.vmdl_c', 'materials/models/npc/patron_sapphire/color.vtex_c']);
    const result = resolveModClassification(mod, { globalType: 'patron', globalTypeSource: 'manual',
        propDetection: { version: 1, size: mod.size, modifiedAt: mod.installedAt, types: ['patron', 'boxes'] } });
    expect(result.propTypes).toEqual(['hidden-king', 'archmother']);
    expect(result.metadataPatch?.propDetection?.version).toBe(2);
});
