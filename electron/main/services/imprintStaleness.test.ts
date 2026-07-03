/**
 * Coverage for the pure embed-staleness predicate (imprintStaleness.ts): the
 * classification core shared by imprintAllInstalled's processOne and
 * imprintPreflight. Pure data in, pure data out: no fs, no electron, no mocks.
 */
import { describe, it, expect } from 'vitest';
import type { ModinfoModRecord, ModinfoMergeRecord } from '../../../src/types/modinfo';
import {
    evaluateEmbedStaleness,
    gameBananaPageUrl,
    refreshableFieldsFromMetadata,
    refreshableFieldsFromRecord,
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
