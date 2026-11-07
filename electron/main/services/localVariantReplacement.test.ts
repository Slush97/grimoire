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
    it('restores group membership without copying classification from the source or its peers', () => {
        const all = [
            member({ id: 'old', name: 'CompLock', gameBananaId: 7, gameBananaFileId: 9,
                localGroupId: 'group-1', lockerHero: 'Ivy', lockerHeroSource: 'manual' }),
            member({ id: 'peer', localGroupId: 'group-1', globalType: 'hud', globalTypeSource: 'manual' }),
            member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10,
                globalType: 'maps', globalTypeSource: 'manual', resolvedGlobalType: 'maps', resolvedHeroes: [] }),
        ];
        const before = structuredClone(all);
        expect(planLocalVariantReplacementRestore(all, args)).toEqual({
            groupId: 'group-1', modName: 'CompLock', replacementMetaKeys: ['fresh.vpk'],
        });
        expect(all).toEqual(before);
    });

    it.each([
        { resolvedHeroes: ['Ivy'] },
        { resolvedHeroes: ['Haze', 'Wraith'] },
        { lockerHero: 'Haze', lockerHeroSource: 'manual' as const },
        { globalType: 'hud' as const, globalTypeSource: 'manual' as const },
        { globalType: null, globalTypeSource: 'manual' as const },
        {},
    ])('preserves the replacement identity independently of the group: %j', identity => {
        const replacement = member({ id: 'fresh', gameBananaId: 7, gameBananaFileId: 10, ...identity });
        const plan = planLocalVariantReplacementRestore([
            member({ id: 'old', gameBananaId: 7, gameBananaFileId: 9, localGroupId: 'group-1',
                resolvedHeroes: ['Ivy', 'Lady Geist'] }),
            replacement,
        ], args);
        expect(plan).toEqual({ groupId: 'group-1', modName: 'old', replacementMetaKeys: ['fresh.vpk'] });
        expect(replacement).toMatchObject(identity);
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
