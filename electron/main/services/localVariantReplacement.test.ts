import { describe, expect, it } from 'vitest';
import {
    planLocalVariantReplacementRestore,
    type LocalVariantReplacementMember,
} from './localVariantReplacement';

const member = (
    options: Partial<LocalVariantReplacementMember> & Pick<LocalVariantReplacementMember, 'id'>
): LocalVariantReplacementMember => ({
    metaKey: `${options.id}.vpk`,
    name: options.id,
    ...options,
});

const args = {
    sourceModId: 'old',
    sourceGameBananaFileId: 9,
    replacementModIds: ['fresh'],
    expectedGameBananaId: 7,
    replacementGameBananaFileId: 10,
};

describe('planLocalVariantReplacementRestore', () => {
    it('copies the explicit group name and classification to a validated replacement', () => {
        const plan = planLocalVariantReplacementRestore([
            member({
                id: 'old',
                name: 'My variants',
                gameBananaId: 7,
                gameBananaFileId: 9,
                localGroupId: 'group-1',
                lockerHero: 'Ivy',
                lockerHeroSource: 'manual',
                globalType: null,
            }),
            member({ id: 'peer', localGroupId: 'group-1', lockerHero: 'Ivy', lockerHeroSource: 'manual', globalType: null }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 }),
        ], args);

        expect(plan).toEqual({
            groupId: 'group-1',
            modName: 'My variants',
            classification: {
                lockerHero: 'Ivy',
                lockerHeroSource: 'manual',
                globalType: undefined,
                globalTypeSource: undefined,
            },
            replacementMetaKeys: ['fresh.vpk'],
        });
    });

    it('retains membership without transferring predecessor automatic hero matches', () => {
        const plan = planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                lockerHero: 'Ivy', lockerHeroSource: 'vpk', resolvedHeroes: ['Ivy', 'Lady Geist'] }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, resolvedHeroes: ['Lady Geist', 'Ivy'] }),
        ], args);
        expect(plan).toEqual({ groupId: 'group-1', modName: 'old', replacementMetaKeys: ['fresh.vpk'] });
    });

    it('rejects a replacement with a different detected hero set', () => {
        expect(() => planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                resolvedHeroes: ['Ivy', 'Lady Geist'] }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, resolvedHeroes: ['Ivy'] }),
        ], args)).toThrow(/same Locker hero or Global classification/);
    });

    it('retains a manual hero override before comparing the new payload without modifying its automatic detection', () => {
        const replacement = member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, resolvedHeroes: ['Wraith'] });
        Object.freeze(replacement.resolvedHeroes);
        Object.freeze(replacement);
        const plan = planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                lockerHero: 'Haze', lockerHeroSource: 'manual', resolvedHeroes: ['Haze'] }),
            replacement,
        ], args);
        expect(plan.classification).toMatchObject({ lockerHero: 'Haze', lockerHeroSource: 'manual' });
        expect(plan.replacementMetaKeys).toEqual(['fresh.vpk']);
        expect(replacement.resolvedHeroes).toEqual(['Wraith']);
        expect(replacement.lockerHero).toBeUndefined();
    });

    it('retains a manual General override ahead of a replacement hero inferred from its payload', () => {
        const plan = planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                globalType: 'hud', globalTypeSource: 'manual', resolvedGlobalType: 'hud', resolvedHeroes: [] }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, resolvedHeroes: ['Haze'] }),
        ], args);
        expect(plan.classification).toMatchObject({ globalType: 'hud', globalTypeSource: 'manual' });
    });

    it('retains a manual unassigned General choice without clearing the new file’s hero identity', () => {
        const replacement = member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, resolvedHeroes: ['Haze'] });
        const plan = planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                globalType: null, globalTypeSource: 'manual', resolvedHeroes: ['Haze'] }),
            replacement,
        ], args);
        expect(plan.classification).toEqual({ globalType: null, globalTypeSource: 'manual' });
        expect(plan.classification).not.toHaveProperty('lockerHero');
        expect(replacement.resolvedHeroes).toEqual(['Haze']);
    });

    it.each([
        { lockerHero: 'Wraith', lockerHeroSource: 'manual' as const, resolvedHeroes: ['Wraith'] },
        { globalType: 'hud' as const, globalTypeSource: 'manual' as const, resolvedGlobalType: 'hud' as const, resolvedHeroes: [] },
    ])('rejects a destination with a conflicting explicit manual classification: %j', destination => {
        expect(() => planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                lockerHero: 'Haze', lockerHeroSource: 'manual', resolvedHeroes: ['Haze'] }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, ...destination }),
        ], args)).toThrow(/same Locker hero or Global classification/);
    });

    it('rejects a replacement from a different GameBanana file or mod', () => {
        const base = [
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1' }),
            member({ id: 'peer', localGroupId: 'group-1' }),
        ];
        expect(() => planLocalVariantReplacementRestore([
            ...base,
            member({ id: 'fresh', gameBananaId: 8, gameBananaFileId: 10 }),
        ], args)).toThrow('GameBanana provenance');
        expect(() => planLocalVariantReplacementRestore([
            ...base,
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 11 }),
        ], args)).toThrow('file provenance');
    });

    it('rejects a legacy merged output as the update source', () => {
        expect(() => planLocalVariantReplacementRestore([
            member({
                id: 'old',
                gameBananaId: 7,
                localGroupId: 'group-1',
                merged: true,
            }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 }),
        ], args)).toThrow('Merged outputs cannot be local variant update sources');
    });

    it('rejects a standalone source, a foreign group, and false Global metadata', () => {
        expect(() => planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7 }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 }),
        ], args)).toThrow('does not belong');

        expect(() => planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1' }),
            member({ id: 'peer', localGroupId: 'group-1' }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, localGroupId: 'group-2' }),
        ], args)).toThrow('another local variant group');

        expect(() => planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1' }),
            member({ id: 'peer', localGroupId: 'group-1' }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, priorityMod: true }),
        ], args)).toThrow('priority-folder placement');
    });

    it('requires the existing Global restore to move replacements before reattaching them', () => {
        expect(() => planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1', priorityMod: true }),
            member({ id: 'peer', localGroupId: 'group-1', priorityMod: true }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10 }),
        ], args)).toThrow('priority-folder placement');

        expect(planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1', priorityMod: true }),
            member({ id: 'peer', localGroupId: 'group-1', priorityMod: true }),
            member({ id: 'fresh-global', gameBananaId: 7, gameBananaFileId: 10, priorityMod: true }),
        ], { ...args, replacementModIds: ['fresh-global'] }).groupId).toBe('group-1');
    });
});
