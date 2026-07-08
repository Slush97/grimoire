/**
 * Coverage for the pure embed-staleness predicate (imprintStaleness.ts): the
 * classification core shared by imprintAllInstalled's processOne and
 * imprintPreflight. Pure data in, pure data out: no fs, no electron, no mocks.
 */
import { describe, it, expect } from 'vitest';
import type { ModinfoModRecord, ModinfoMergeRecord } from '../../../src/types/modinfo';
import type { MergedModInfo, MergedModSource } from '../../../src/types/mod';
import {
    evaluateEmbedStaleness,
    evaluateMergeEmbedStaleness,
    classifyMissingMergeManifest,
    gameBananaPageUrl,
    refreshableFieldsFromMetadata,
    refreshableFieldsFromRecord,
    refreshableMergeFieldsFromMetadata,
    refreshableMergeFieldsFromRecord,
    deriveAdoptionPatch,
    adoptionFieldsFromModRecord,
    adoptionFieldsFromLegacyAddonInfo,
    type ImprintRefreshMeta,
    type RefreshableEmbedFields,
    type AdoptionEmbedFields,
} from './imprintStaleness';

/** A GameBanana-sourced sidecar snapshot, the common case. */
const GB_META: ImprintRefreshMeta = {
    modName: 'Neon Vindicta',
    author: 'someauthor',
    gameBananaId: 4242,
    gameBananaFileId: 9001,
    sourceSection: 'Mod',
    categoryId: 77,
    categoryName: 'Vindicta',
    vpkIndex: 1,
    variantLabel: 'gold',
};

/** The embedded record buildModinfoRecord would have written for GB_META. */
function recordFor(meta: ImprintRefreshMeta, fallbackTitle = 'pak01'): ModinfoModRecord {
    const fields = refreshableFieldsFromMetadata(meta, fallbackTitle);
    return {
        format: 'vpk-modinfo',
        schemaVersion: 1,
        kind: 'mod',
        writtenBy: { tool: 'grimoire', version: '0.0.0-test' },
        writtenAt: '2026-01-01T00:00:00.000Z',
        firstImprintedAt: '2025-06-01T00:00:00.000Z',
        game: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
        identity: { sha256: 'a'.repeat(64), size: 1234 },
        title: fields.title,
        author: fields.author,
        description: fields.description,
        source: fields.gamebananaId
            ? {
                gamebananaId: fields.gamebananaId,
                gamebananaFileId: fields.gamebananaFileId,
                url: fields.sourceUrl,
                section: fields.section,
                categoryId: fields.categoryId,
                categoryName: fields.categoryName,
            }
            : undefined,
        packaging:
            fields.vpkIndex !== undefined || fields.variantLabel
                ? { vpkIndex: fields.vpkIndex, variantLabel: fields.variantLabel }
                : undefined,
    };
}

describe('evaluateEmbedStaleness', () => {
    it('is stale with no current-format embed (never imprinted / legacy-only / old schema)', () => {
        const result = evaluateEmbedStaleness(null, refreshableFieldsFromMetadata(GB_META, 'pak01'));
        expect(result).toEqual({ stale: true, reason: 'no-current-embed' });
    });

    it('is fresh when every refreshable field matches the sidecar', () => {
        const result = evaluateEmbedStaleness(
            recordFor(GB_META),
            refreshableFieldsFromMetadata(GB_META, 'pak01')
        );
        expect(result).toEqual({ stale: false });
    });

    it('ignores non-refreshable fields (identity / writtenAt / firstImprintedAt / writtenBy)', () => {
        const embedded: ModinfoModRecord = {
            ...recordFor(GB_META),
            writtenAt: '2020-01-01T00:00:00.000Z',
            firstImprintedAt: '2019-01-01T00:00:00.000Z',
            writtenBy: { tool: 'grimoire', version: '0.0.1-other-machine' },
            identity: { sha256: 'b'.repeat(64), size: 999, crc32: 'deadbeef' },
        };
        const result = evaluateEmbedStaleness(
            embedded,
            refreshableFieldsFromMetadata(GB_META, 'pak01')
        );
        expect(result).toEqual({ stale: false });
    });

    // Every refreshable field, drifted one at a time: the mod was identified /
    // renamed / re-labeled after imprinting, so the embed needs a refresh.
    const driftCases: Array<{ field: string; drift: Partial<ImprintRefreshMeta> }> = [
        { field: 'title', drift: { modName: 'Renamed Vindicta' } },
        { field: 'author', drift: { author: 'newauthor' } },
        { field: 'gamebananaId', drift: { gameBananaId: 5555 } },
        { field: 'gamebananaFileId', drift: { gameBananaFileId: 9002 } },
        { field: 'section', drift: { sourceSection: 'Sound' } },
        { field: 'categoryId', drift: { categoryId: 78 } },
        { field: 'categoryName', drift: { categoryName: 'Lady Geist' } },
        { field: 'vpkIndex', drift: { vpkIndex: 2 } },
        { field: 'variantLabel', drift: { variantLabel: 'silver' } },
    ];
    it.each(driftCases)('is stale when $field drifts from the sidecar', ({ field, drift }) => {
        const result = evaluateEmbedStaleness(
            recordFor(GB_META),
            refreshableFieldsFromMetadata({ ...GB_META, ...drift }, 'pak01')
        );
        expect(result.stale).toBe(true);
        if (result.stale && result.reason === 'fields-drifted') {
            expect(result.driftedFields).toContain(field);
        } else {
            expect.fail(`expected fields-drifted, got ${JSON.stringify(result)}`);
        }
    });

    it('is stale when a field was CLEARED in the sidecar (present -> absent)', () => {
        const cleared: ImprintRefreshMeta = { ...GB_META, variantLabel: undefined };
        const result = evaluateEmbedStaleness(
            recordFor(GB_META),
            refreshableFieldsFromMetadata(cleared, 'pak01')
        );
        expect(result).toEqual({
            stale: true,
            reason: 'fields-drifted',
            driftedFields: ['variantLabel'],
        });
    });

    it('treats absent == absent (both sides omit the optionals)', () => {
        const local: ImprintRefreshMeta = { modName: 'Local Mod' };
        const result = evaluateEmbedStaleness(
            recordFor(local),
            refreshableFieldsFromMetadata(local, 'pak01')
        );
        expect(result).toEqual({ stale: false });
    });

    it('treats an empty / whitespace-only string as absent (normalized compare)', () => {
        const current: RefreshableEmbedFields = {
            ...refreshableFieldsFromMetadata(GB_META, 'pak01'),
            variantLabel: '   ',
        };
        const embedded = recordFor({ ...GB_META, variantLabel: undefined });
        expect(evaluateEmbedStaleness(embedded, current)).toEqual({ stale: false });
    });

    it('never marks a kind:"merge" record stale (a single-mod re-imprint would clobber it)', () => {
        const merge: ModinfoMergeRecord = {
            ...recordFor(GB_META),
            kind: 'merge',
            title: 'My Merge',
            author: 'Multiple (merged)',
            source: undefined,
            merge: { title: 'My Merge' },
            sources: [],
        };
        const result = evaluateEmbedStaleness(
            merge,
            refreshableFieldsFromMetadata(undefined, 'pak05')
        );
        expect(result).toEqual({ stale: false });
    });

    // --- directional hardening: a richer embed over an emptier sidecar is
    // adoption material, not staleness (see IDENTITY_BEARING_KEYS). ------------

    describe('directional hardening (richer embed, emptier sidecar)', () => {
        const identityDriftCases: Array<{ field: string; drift: Partial<ImprintRefreshMeta> }> = [
            { field: 'gamebananaId', drift: { gameBananaId: undefined } },
            { field: 'gamebananaFileId', drift: { gameBananaFileId: undefined } },
            { field: 'author', drift: { author: undefined } },
            { field: 'section', drift: { sourceSection: undefined } },
            { field: 'categoryId', drift: { categoryId: undefined } },
            { field: 'categoryName', drift: { categoryName: undefined } },
        ];
        it.each(identityDriftCases)(
            'does not flag $field when the embed has it but the sidecar does not',
            ({ field, drift }) => {
                const impoverished: ImprintRefreshMeta = { ...GB_META, ...drift };
                const result = evaluateEmbedStaleness(
                    recordFor(GB_META),
                    refreshableFieldsFromMetadata(impoverished, 'pak01')
                );
                if (result.stale && result.reason === 'fields-drifted') {
                    expect(result.driftedFields).not.toContain(field);
                } else {
                    expect(result).toEqual({ stale: false });
                }
            }
        );

        it('is fresh overall when only identity-bearing fields are richer in the embed', () => {
            // Sidecar keeps every non-identity field (vpkIndex/variantLabel) but
            // is missing every identity-bearing one; gbId absent also gates
            // fileId/section/category to absent via refreshableFieldsFromMetadata.
            const impoverished: ImprintRefreshMeta = {
                modName: GB_META.modName,
                vpkIndex: GB_META.vpkIndex,
                variantLabel: GB_META.variantLabel,
            };
            const result = evaluateEmbedStaleness(
                recordFor(GB_META),
                refreshableFieldsFromMetadata(impoverished, 'pak01')
            );
            expect(result).toEqual({ stale: false });
        });

        it('still flags real drift: sidecar-has/embed-lacks on an identity field', () => {
            // The embed was imprinted before the sidecar learned the author; the
            // sidecar is now richer than the embed - this is legitimate refresh
            // work, not adoption direction, so it must stay stale.
            const embeddedWithoutAuthor = recordFor({ ...GB_META, author: undefined });
            const result = evaluateEmbedStaleness(
                embeddedWithoutAuthor,
                refreshableFieldsFromMetadata(GB_META, 'pak01')
            );
            expect(result.stale).toBe(true);
            if (result.stale && result.reason === 'fields-drifted') {
                expect(result.driftedFields).toContain('author');
            } else {
                expect.fail(`expected fields-drifted, got ${JSON.stringify(result)}`);
            }
        });

        it('still flags real drift: both sides present but different on an identity field', () => {
            const result = evaluateEmbedStaleness(
                recordFor(GB_META),
                refreshableFieldsFromMetadata({ ...GB_META, gameBananaId: 9999 }, 'pak01')
            );
            expect(result.stale).toBe(true);
            if (result.stale && result.reason === 'fields-drifted') {
                expect(result.driftedFields).toContain('gamebananaId');
            } else {
                expect.fail(`expected fields-drifted, got ${JSON.stringify(result)}`);
            }
        });

        it('still flags drift on non-identity fields even when the embed is richer (vpkIndex, variantLabel, title)', () => {
            const impoverished: ImprintRefreshMeta = { ...GB_META, vpkIndex: undefined, variantLabel: undefined };
            const result = evaluateEmbedStaleness(
                recordFor(GB_META),
                refreshableFieldsFromMetadata(impoverished, 'pak01')
            );
            expect(result.stale).toBe(true);
            if (result.stale && result.reason === 'fields-drifted') {
                expect(result.driftedFields).toEqual(expect.arrayContaining(['vpkIndex', 'variantLabel']));
            } else {
                expect.fail(`expected fields-drifted, got ${JSON.stringify(result)}`);
            }
        });
    });
});

describe('refreshableFieldsFromMetadata', () => {
    it('gates every source-derived field on gameBananaId (local mod with stray sidecar fields)', () => {
        const local: ImprintRefreshMeta = {
            modName: 'Local Mod',
            sourceSection: 'Mod',
            categoryId: 12,
            categoryName: 'Skins',
        };
        expect(refreshableFieldsFromMetadata(local, 'pak01')).toEqual({
            title: 'Local Mod',
            author: undefined,
            description: undefined,
            gamebananaId: undefined,
            gamebananaFileId: undefined,
            sourceUrl: undefined,
            section: undefined,
            categoryId: undefined,
            categoryName: undefined,
            vpkIndex: undefined,
            variantLabel: undefined,
        });
    });

    it('falls back to the scan-derived title when the sidecar has no modName', () => {
        expect(refreshableFieldsFromMetadata(undefined, 'pak03').title).toBe('pak03');
        expect(refreshableFieldsFromMetadata({ modName: '' }, 'pak03').title).toBe('pak03');
    });

    it('derives the sounds URL path for Sound-section mods', () => {
        const fields = refreshableFieldsFromMetadata(
            { modName: 'VO Pack', gameBananaId: 100, sourceSection: 'Sound' },
            'pak01'
        );
        expect(fields.sourceUrl).toBe('https://gamebanana.com/sounds/100');
        expect(gameBananaPageUrl(100, 'Mod')).toBe('https://gamebanana.com/mods/100');
        expect(gameBananaPageUrl(undefined, 'Mod')).toBeUndefined();
    });
});

describe('refreshableFieldsFromRecord', () => {
    it('round-trips: a record built from a sidecar projects back to the same fields', () => {
        const fields = refreshableFieldsFromMetadata(GB_META, 'pak01');
        expect(refreshableFieldsFromRecord(recordFor(GB_META))).toEqual(fields);
    });

    it('reads absent source/packaging blocks as absent fields', () => {
        const record = recordFor({ modName: 'Local Mod' });
        const fields = refreshableFieldsFromRecord(record);
        expect(fields.gamebananaId).toBeUndefined();
        expect(fields.sourceUrl).toBeUndefined();
        expect(fields.vpkIndex).toBeUndefined();
        expect(fields.variantLabel).toBeUndefined();
    });
});

// --- merge embed staleness ---------------------------------------------------

const SOURCE_A: MergedModSource = {
    fileName: 'source-a.vpk',
    modName: 'Source A',
    gameBananaId: 111,
    gameBananaFileId: 222,
    section: 'Mod',
    enabledAtMergeTime: true,
    priorityAtMergeTime: 3,
    sha256AtMergeTime: 'a'.repeat(64),
};

const SOURCE_B: MergedModSource = {
    fileName: 'source-b.vpk',
    modName: 'Source B',
    enabledAtMergeTime: false,
    priorityAtMergeTime: 5,
    sha256AtMergeTime: 'b'.repeat(64),
};

const MERGED_INFO: MergedModInfo = {
    id: 'merge-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    shareCode: 'mp1:stub',
    sources: [SOURCE_A, SOURCE_B],
};

describe('evaluateMergeEmbedStaleness', () => {
    const currentFields = () => refreshableMergeFieldsFromMetadata('My Merge', MERGED_INFO);
    const embeddedFieldsFor = (info: MergedModInfo, title: string) =>
        refreshableMergeFieldsFromRecord({
            title,
            sources: info.sources.map((s) => ({
                title: s.modName,
                identity: { sha256: s.sha256AtMergeTime },
                gamebananaId: s.gameBananaId,
                gamebananaFileId: s.gameBananaFileId,
                section: s.section,
                priorityAtMergeTime: s.priorityAtMergeTime,
                enabledAtMergeTime: s.enabledAtMergeTime,
                fileNameAtMergeTime: s.fileName,
            })),
        });

    it('is stale with no current embed (never imprinted / legacy-only)', () => {
        expect(evaluateMergeEmbedStaleness(null, currentFields())).toEqual({
            stale: true,
            reason: 'no-current-embed',
        });
    });

    it('is fresh when the title and every source field match the manifest', () => {
        const result = evaluateMergeEmbedStaleness(embeddedFieldsFor(MERGED_INFO, 'My Merge'), currentFields());
        expect(result).toEqual({ stale: false });
    });

    it('is stale when the merge title drifted (re-labeled after imprint)', () => {
        const result = evaluateMergeEmbedStaleness(embeddedFieldsFor(MERGED_INFO, 'Old Name'), currentFields());
        expect(result.stale).toBe(true);
        if (result.stale && result.reason === 'fields-drifted') {
            expect(result.driftedFields).toContain('title');
        } else {
            expect.fail(`expected fields-drifted, got ${JSON.stringify(result)}`);
        }
    });

    it('is stale when a source field drifted (source metadata edited after imprint)', () => {
        const relabeled: MergedModInfo = {
            ...MERGED_INFO,
            sources: [{ ...SOURCE_A, modName: 'Renamed Source A' }, SOURCE_B],
        };
        const result = evaluateMergeEmbedStaleness(
            embeddedFieldsFor(MERGED_INFO, 'My Merge'),
            refreshableMergeFieldsFromMetadata('My Merge', relabeled)
        );
        expect(result.stale).toBe(true);
        if (result.stale && result.reason === 'fields-drifted') {
            expect(result.driftedFields).toContain('sources');
        } else {
            expect.fail(`expected fields-drifted, got ${JSON.stringify(result)}`);
        }
    });

    it('is stale when the source count changed (a source was extracted)', () => {
        const oneFewer: MergedModInfo = { ...MERGED_INFO, sources: [SOURCE_A] };
        const result = evaluateMergeEmbedStaleness(
            embeddedFieldsFor(MERGED_INFO, 'My Merge'),
            refreshableMergeFieldsFromMetadata('My Merge', oneFewer)
        );
        expect(result).toEqual({ stale: true, reason: 'fields-drifted', driftedFields: ['sources'] });
    });

    it('falls back to the manifest id when modName is unset (never perpetually drifted)', () => {
        expect(refreshableMergeFieldsFromMetadata(undefined, MERGED_INFO).title).toBe('merge-1');
    });
});

// --- never-flatten guard ------------------------------------------------------

describe('classifyMissingMergeManifest', () => {
    it('reconstructs from the embed when the current-format record is itself a merge', () => {
        expect(classifyMissingMergeManifest('merge', false)).toEqual({ kind: 'reconstruct-from-embed' });
        // Even when a legacy companion also happens to be readable, the embed
        // (Grimoire's own last write) is the richer, more current source.
        expect(classifyMissingMergeManifest('merge', true)).toEqual({ kind: 'reconstruct-from-embed' });
    });

    it('reconstructs from the legacy companion when there is no current embed but legacy sources parse', () => {
        expect(classifyMissingMergeManifest(null, true)).toEqual({ kind: 'reconstruct-from-legacy' });
    });

    it('needs no manifest for a genuine plain mod (current-format kind:"mod" record)', () => {
        expect(classifyMissingMergeManifest('mod', false)).toEqual({ kind: 'no-manifest-needed' });
        expect(classifyMissingMergeManifest('mod', true)).toEqual({ kind: 'no-manifest-needed' });
    });

    it('needs no manifest when neither the embed nor a legacy companion has a source list', () => {
        expect(classifyMissingMergeManifest(null, false)).toEqual({ kind: 'no-manifest-needed' });
    });
});

// --- adoption --------------------------------------------------------------

describe('adoptionFieldsFromModRecord', () => {
    it('projects a refreshable current-format record onto the adoption input shape', () => {
        const fields = refreshableFieldsFromRecord(recordFor(GB_META));
        expect(adoptionFieldsFromModRecord(fields)).toEqual({
            title: GB_META.modName,
            author: GB_META.author,
            gamebananaId: GB_META.gameBananaId,
            gamebananaFileId: GB_META.gameBananaFileId,
            section: GB_META.sourceSection,
            categoryId: GB_META.categoryId,
            categoryName: GB_META.categoryName,
            vpkIndex: GB_META.vpkIndex,
            variantLabel: GB_META.variantLabel,
        });
    });
});

describe('adoptionFieldsFromLegacyAddonInfo', () => {
    it('coerces the legacy string gamebananaId/gamebananaFileId to numbers', () => {
        expect(
            adoptionFieldsFromLegacyAddonInfo({
                title: 'Legacy Mod',
                author: 'legacyauthor',
                gamebananaId: '4242',
                gamebananaFileId: '9001',
            })
        ).toEqual({
            title: 'Legacy Mod',
            author: 'legacyauthor',
            gamebananaId: 4242,
            gamebananaFileId: 9001,
        });
    });

    it('drops an unparseable numeric string instead of yielding NaN', () => {
        const result = adoptionFieldsFromLegacyAddonInfo({
            title: 'Legacy Mod',
            gamebananaId: 'not-a-number',
        });
        expect(result.gamebananaId).toBeUndefined();
    });

    it('has no section/category/vpkIndex fields (legacy addoninfo.txt never carried them)', () => {
        const result = adoptionFieldsFromLegacyAddonInfo({ title: 'Legacy Mod' });
        expect(result.section).toBeUndefined();
        expect(result.categoryId).toBeUndefined();
        expect(result.categoryName).toBeUndefined();
        expect(result.vpkIndex).toBeUndefined();
        expect(result.variantLabel).toBeUndefined();
    });
});

describe('deriveAdoptionPatch', () => {
    const RICH_EMBED: AdoptionEmbedFields = {
        title: 'Neon Vindicta',
        author: 'someauthor',
        gamebananaId: 4242,
        gamebananaFileId: 9001,
        section: 'Mod',
        categoryId: 77,
        categoryName: 'Vindicta',
        vpkIndex: 1,
        variantLabel: 'gold',
    };

    it('returns an empty patch when the embed is null (nothing to adopt from)', () => {
        expect(deriveAdoptionPatch(null, { modName: 'Local Mod' })).toEqual({});
    });

    it('returns an empty patch when the embed is empty (no fields to offer)', () => {
        expect(deriveAdoptionPatch({}, undefined)).toEqual({});
    });

    it('fills every adoptable field when the sidecar has none of them', () => {
        expect(deriveAdoptionPatch(RICH_EMBED, undefined)).toEqual({
            modName: 'Neon Vindicta',
            author: 'someauthor',
            gameBananaId: 4242,
            gameBananaFileId: 9001,
            sourceSection: 'Mod',
            categoryId: 77,
            categoryName: 'Vindicta',
            vpkIndex: 1,
            variantLabel: 'gold',
        });
    });

    // Table-driven: fill-missing semantics per field, one at a time.
    const fillMissingCases: Array<{
        sidecarField: keyof ImprintRefreshMeta;
        patchField: string;
        expected: string | number;
    }> = [
        { sidecarField: 'author', patchField: 'author', expected: 'someauthor' },
        { sidecarField: 'gameBananaId', patchField: 'gameBananaId', expected: 4242 },
        { sidecarField: 'gameBananaFileId', patchField: 'gameBananaFileId', expected: 9001 },
        { sidecarField: 'sourceSection', patchField: 'sourceSection', expected: 'Mod' },
        { sidecarField: 'categoryId', patchField: 'categoryId', expected: 77 },
        { sidecarField: 'categoryName', patchField: 'categoryName', expected: 'Vindicta' },
        { sidecarField: 'vpkIndex', patchField: 'vpkIndex', expected: 1 },
        { sidecarField: 'variantLabel', patchField: 'variantLabel', expected: 'gold' },
    ];
    it.each(fillMissingCases)(
        'adopts $patchField alone when only that sidecar field is missing',
        ({ sidecarField, patchField, expected }) => {
            // Every OTHER field already present in the sidecar (so only the one
            // field under test is missing and eligible for adoption).
            const almostFull: ImprintRefreshMeta = {
                modName: 'Neon Vindicta',
                author: 'someauthor',
                gameBananaId: 4242,
                gameBananaFileId: 9001,
                sourceSection: 'Mod',
                categoryId: 77,
                categoryName: 'Vindicta',
                vpkIndex: 1,
                variantLabel: 'gold',
                [sidecarField]: undefined,
            };
            const patch = deriveAdoptionPatch(RICH_EMBED, almostFull);
            expect(patch).toEqual({ [patchField]: expected });
        }
    );

    it('adopts modName from the embed title only when the sidecar has none', () => {
        expect(deriveAdoptionPatch(RICH_EMBED, undefined).modName).toBe('Neon Vindicta');
        expect(deriveAdoptionPatch(RICH_EMBED, { modName: '' }).modName).toBe('Neon Vindicta');
        expect(deriveAdoptionPatch(RICH_EMBED, { modName: '   ' }).modName).toBe('Neon Vindicta');
    });

    it('NEVER overwrites a present sidecar value, even when the embed disagrees', () => {
        const fullSidecar: ImprintRefreshMeta = {
            modName: 'User Renamed It',
            author: 'differentauthor',
            gameBananaId: 5555,
            gameBananaFileId: 6666,
            sourceSection: 'Sound',
            categoryId: 88,
            categoryName: 'Lady Geist',
            vpkIndex: 2,
            variantLabel: 'silver',
        };
        expect(deriveAdoptionPatch(RICH_EMBED, fullSidecar)).toEqual({});
    });

    it('fills only the missing subset when the sidecar is partially populated', () => {
        const partial: ImprintRefreshMeta = {
            modName: 'User Renamed It', // user already typed a name: never touched
            gameBananaId: 4242, // already known: never touched
            // gameBananaFileId, author, section, category, vpkIndex, variantLabel: all missing
        };
        expect(deriveAdoptionPatch(RICH_EMBED, partial)).toEqual({
            gameBananaFileId: 9001,
            author: 'someauthor',
            sourceSection: 'Mod',
            categoryId: 77,
            categoryName: 'Vindicta',
            vpkIndex: 1,
            variantLabel: 'gold',
        });
    });

    it('treats an empty / whitespace-only sidecar string as missing (normalized compare)', () => {
        const whitespaceAuthor: ImprintRefreshMeta = { author: '   ' };
        expect(deriveAdoptionPatch(RICH_EMBED, whitespaceAuthor).author).toBe('someauthor');
    });

    it('adopts from a legacy-embed-shaped input too (title/gamebananaId from old addoninfo keys)', () => {
        const legacyEmbed = adoptionFieldsFromLegacyAddonInfo({
            title: 'Legacy Vindicta',
            author: 'legacyauthor',
            gamebananaId: '1234',
            gamebananaFileId: '5678',
        });
        // Legacy addoninfo.txt never carried section/category/vpkIndex, so those
        // simply aren't offered - the patch only contains what the legacy embed
        // actually had.
        expect(deriveAdoptionPatch(legacyEmbed, undefined)).toEqual({
            modName: 'Legacy Vindicta',
            author: 'legacyauthor',
            gameBananaId: 1234,
            gameBananaFileId: 5678,
        });
    });

    it('is a no-op for a merge candidate: the caller never invokes this for one, but even a merge-shaped adoption-fields projection with no plain-mod fields yields nothing new beyond title/author', () => {
        // adoptionFieldsFromModRecord only pulls the flat single-mod fields
        // (title/author/section/category/vpkIndex), which a kind:"merge" record
        // does carry as top-level title/author but never as `source`/`packaging`
        // (those are single-mod-only blocks). This test documents that even if
        // a caller mistakenly fed a merge's projected fields in here, no
        // gamebananaId/section/category/vpkIndex would leak through, since a
        // merge record structurally has none at the top level.
        const mergeProjectedFields: AdoptionEmbedFields = { title: 'My Merge', author: 'Multiple (merged)' };
        expect(deriveAdoptionPatch(mergeProjectedFields, undefined)).toEqual({
            modName: 'My Merge',
            author: 'Multiple (merged)',
        });
    });

    it('never includes sha256 or any identity field in the returned patch (KEYSTONE)', () => {
        const patch = deriveAdoptionPatch(RICH_EMBED, undefined);
        expect(patch).not.toHaveProperty('sha256');
        expect(patch).not.toHaveProperty('sha256AtMergeTime');
        expect(patch).not.toHaveProperty('sha256AtApplyTime');
        expect(patch).not.toHaveProperty('imprinted');
        expect(patch).not.toHaveProperty('imprintStale');
    });
});
