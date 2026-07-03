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
    type ImprintRefreshMeta,
    type RefreshableEmbedFields,
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
