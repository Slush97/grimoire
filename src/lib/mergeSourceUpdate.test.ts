import { describe, expect, it } from 'vitest';
import { mergeSourceModIds, planMergeSourceUpdates } from './mergeSourceUpdate';
import { computeUpdateFlags, mergeSourceFileIds } from './updateCheck';
import type { GameBananaFile } from '../types/gamebanana';
import type { MergedModSource } from '../types/mod';

const file = (
  id: number,
  fileName: string,
  isArchived = false,
  description?: string,
): GameBananaFile => ({
  id,
  fileName,
  fileSize: 1,
  downloadUrl: `https://gamebanana.com/dl/${id}`,
  downloadCount: 0,
  isArchived,
  description,
});

const source = (over: Partial<MergedModSource> = {}): MergedModSource => ({
  fileName: 'source_dir.vpk',
  modName: 'Source',
  gameBananaId: 700,
  gameBananaFileId: 1000,
  section: 'Mod',
  enabledAtMergeTime: true,
  priorityAtMergeTime: 5,
  sha256AtMergeTime: 'a'.repeat(64),
  ...over,
});

/** Plans with every given source flagged, the way a merge of only stale sources is. */
const planStale = (
  sources: readonly MergedModSource[],
  files: ReadonlyMap<number, readonly GameBananaFile[]>,
  claimed?: ReadonlySet<number>,
  autoMatch?: boolean,
) => planMergeSourceUpdates(sources, new Set(sources.map((entry) => entry.fileName)), files, claimed, autoMatch);

describe('planMergeSourceUpdates', () => {
  it('excludes current files already used by a merge from the remaining-file count', () => {
    const stale = source();
    const files = new Map([[700, [file(2000, 'kept_variant.zip'), file(3000, 'renamed.zip')]]]);
    const plan = planStale([stale], files, new Set([1000, 2000]), true);
    expect(plan.resolved.map((entry) => entry.fileId)).toEqual([3000]);
  });

  it('uses the remaining-file preference when resolving a renamed merge source', () => {
    const stale = source();
    const files = new Map([[700, [file(2000, 'renamed.zip')]]]);
    expect(planStale([stale], files, undefined, true).resolved.map((entry) => entry.fileId)).toEqual([2000]);
    expect(planStale([stale], files, undefined, false).unresolved).toEqual([
      { source: stale, reason: 'no-match' },
    ]);
  });

  it('matches the replacement by filename token overlap', () => {
    const files = [
      file(1000, 'galaxy_rem_gold_v1.zip', true),
      file(1001, 'galaxy_rem_gold_08_12.zip'),
      file(1002, 'totally_different_thing.zip'),
    ];

    const plan = planStale([source()], new Map([[700, files]]));

    expect(plan.unresolved).toEqual([]);
    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0]).toMatchObject({
      gameBananaId: 700,
      fileId: 1001,
      fileName: 'galaxy_rem_gold_08_12.zip',
      section: 'Mod',
    });
  });

  it('leaves a source unresolved when the sole current file only shares a name word', () => {
    const files = [file(1000, 'galaxy_rem_gold.zip', true), file(1500, 'galaxy_remastered.7z')];

    const plan = planStale([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved).toEqual([{ source: source(), reason: 'no-match' }]);
  });

  it('leaves a deleted source with nothing to go on unresolved', () => {
    // A merge records no filename or description, so a deleted source has no
    // signal at all; the sole current file is not assumed to replace it.
    const plan = planStale([source()], new Map([[700, [file(1500, 'all_in_one.7z')]]]));

    expect(plan.unresolved).toEqual([{ source: source(), reason: 'no-match' }]);
  });

  it('never maps an archived source onto the single current file', () => {
    // Before: the single-current fallback swapped an archived addon for the
    // main file. An archived row is often a retired addon, not an old version.
    const files = [file(1000, 'optional_addon_icons.zip', true), file(1500, 'main_v3.zip')];

    const plan = planStale([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved).toEqual([{ source: source(), reason: 'no-match' }]);
  });

  it('never lets two outdated sources claim the same replacement file', () => {
    // Both sources are deleted and only one current file exists. Picking
    // either would swap unrelated content into the merge, so neither does.
    const files = [file(1500, 'only_current.zip')];
    const sources = [
      source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 }),
      source({ fileName: 'b_dir.vpk', gameBananaFileId: 1001 }),
    ];

    const plan = planStale(sources, new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved).toEqual([
      { source: sources[0], reason: 'no-match' },
      { source: sources[1], reason: 'no-match' },
    ]);
  });

  it('resolves several outdated sources of one mod to their own successors', () => {
    const files = [
      file(1000, 'skin_red_v1.zip', true),
      file(1001, 'skin_blue_v1.zip', true),
      file(1500, 'skin_red_v2.zip'),
      file(1501, 'skin_blue_v2.zip'),
    ];
    const sources = [
      source({ fileName: 'a_dir.vpk', gameBananaFileId: 1001 }),
      source({ fileName: 'b_dir.vpk', gameBananaFileId: 1000 }),
    ];

    const plan = planStale(sources, new Map([[700, files]]));

    expect(plan.resolved.map((entry) => [entry.sources[0].fileName, entry.fileId])).toEqual([
      ['a_dir.vpk', 1501],
      ['b_dir.vpk', 1500],
    ]);
  });

  it('respects file ids already claimed outside the plan', () => {
    const files = [file(1500, 'only_current.zip')];

    const plan = planStale(
      [source()],
      new Map([[700, files]]),
      new Set([1500]),
    );

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved[0].reason).toBe('no-match');
  });

  it('reports ambiguity instead of guessing between several current files', () => {
    const files = [
      file(1000, 'old.zip', true),
      file(1501, 'unrelated_one.zip'),
      file(1502, 'unrelated_two.zip'),
    ];

    const plan = planStale([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved[0].reason).toBe('no-match');
  });

  it('flags sources with no recorded provenance', () => {
    const noIds = source({ gameBananaId: undefined, gameBananaFileId: undefined });

    const plan = planStale([noIds], new Map());

    expect(plan.unresolved).toEqual([{ source: noIds, reason: 'no-provenance' }]);
  });

  it('flags sources whose file list could not be fetched', () => {
    const plan = planStale([source()], new Map());

    expect(plan.unresolved).toEqual([{ source: source(), reason: 'files-unavailable' }]);
  });

  it('carries the source section through so the download hits the right endpoint', () => {
    const files = [file(1000, 'voice_pack_v1.zip', true), file(1500, 'voice_pack_v2.zip')];

    const plan = planStale(
      [source({ section: 'Sound' })],
      new Map([[700, files]]),
    );

    expect(plan.resolved[0].section).toBe('Sound');
  });

  it('follows the archived row description when the filename says nothing', () => {
    const files = [
      file(1000, 'pack_a.zip', true, 'Red variant'),
      file(1501, 'blue_upload.zip', false, 'Blue variant'),
      file(1502, 'completely_renamed.zip', false, 'Red variant'),
    ];

    const plan = planStale([source()], new Map([[700, files]]));

    expect(plan.resolved[0].fileId).toBe(1502);
  });

  it('refuses a description match that the filename contradicts', () => {
    // Before: the description always won. Authors sometimes swap descriptions
    // between re-uploads, so a disagreement is not a confident successor.
    const files = [
      file(1000, 'pack_a.zip', true, 'Red variant'),
      file(1501, 'pack_a_updated.zip', false, 'Blue variant'),
      file(1502, 'completely_renamed.zip', false, 'Red variant'),
    ];

    const plan = planStale([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved[0].reason).toBe('no-match');
  });

  it('resolves every VPK cut from one stale file together, so it downloads once', () => {
    const files = [file(1000, 'pack_v1.zip', true), file(1500, 'pack_v2.zip'), file(1501, 'extras.zip')];
    const sources = [
      source({ fileName: 'pak10_dir.vpk', gameBananaFileId: 1000 }),
      source({ fileName: 'pak11_dir.vpk', gameBananaFileId: 1000 }),
    ];

    const plan = planStale(sources, new Map([[700, files]]));

    expect(plan.resolved).toEqual([
      { sources, gameBananaId: 700, fileId: 1500, fileName: 'pack_v2.zip', section: 'Mod' },
    ]);
    expect(plan.unresolved).toEqual([]);
  });

  it('does not pair a deleted source with an unrelated upload while a sibling source competes for it', () => {
    // The author archived `red` (kept on the page) and deleted `blue`. The only
    // current upload is unrelated. Classifying `blue` alone would see one
    // unmatched source and one spare upload and pair them.
    const red = source({ fileName: 'skin_red_dir.vpk', gameBananaFileId: 1000 });
    const blue = source({ fileName: 'skin_blue_dir.vpk', gameBananaFileId: 1001 });
    const files = new Map([[700, [file(1000, 'skin_red.zip', true), file(1502, 'voicelines_pack.zip')]]]);

    const plan = planMergeSourceUpdates([red, blue], new Set([blue.fileName]), files, undefined, true);

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved).toEqual([{ source: blue, reason: 'no-match' }]);
    // The same upload IS the right pairing when `blue` is the only source.
    expect(planStale([blue], files, undefined, true).resolved.map((entry) => entry.fileId)).toEqual([1502]);
  });

  it('acts only on the flagged sources', () => {
    const files = new Map([[700, [file(1000, 'skin_v1.zip', true), file(1500, 'skin_v2.zip')]]]);
    const stale = source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 });
    const current = source({ fileName: 'b_dir.vpk', gameBananaFileId: 1500 });

    const plan = planMergeSourceUpdates([stale, current], new Set(), files);

    expect(plan).toEqual({ resolved: [], unresolved: [] });
  });

  it('leaves a source unresolved when its successor is already part of the merge', () => {
    const old = source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 });
    const kept = source({ fileName: 'b_dir.vpk', gameBananaFileId: 1500 });
    const files = new Map([[700, [file(1000, 'skin_red_v1.zip', true), file(1500, 'skin_red_v2.zip')]]]);

    const plan = planMergeSourceUpdates([old, kept], new Set([old.fileName]), files);

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved).toEqual([{ source: old, reason: 'no-match' }]);
  });

  it('resolves exactly the sources the update check calls updatable', () => {
    const cases = {
      renamed: {
        files: [file(1000, 'skin_red_v1.zip', true), file(1500, 'skin_red_v2.zip')],
        sources: [source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 })],
      },
      deletedWithoutSignal: {
        files: [file(1500, 'all_in_one.7z')],
        sources: [source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 })],
      },
      successorAlreadyMerged: {
        files: [file(1000, 'skin_red_v1.zip', true), file(1500, 'skin_red_v2.zip')],
        sources: [
          source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 }),
          source({ fileName: 'b_dir.vpk', gameBananaFileId: 1500 }),
        ],
      },
      mixed: {
        files: [file(1000, 'skin_red_v1.zip', true), file(1500, 'skin_red_v2.zip')],
        sources: [
          source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 }),
          source({ fileName: 'b_dir.vpk', gameBananaFileId: 1001 }),
        ],
      },
      siblingCompetes: {
        files: [file(1000, 'skin_red.zip', true), file(1502, 'voicelines_pack.zip')],
        sources: [
          source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 }),
          source({ fileName: 'b_dir.vpk', gameBananaFileId: 1001 }),
        ],
      },
    };
    for (const autoMatch of [true, false]) {
      for (const [name, { files, sources }] of Object.entries(cases)) {
        const merge = { id: 'merge', merged: { sources } };
        const flags = computeUpdateFlags([merge], new Map([[700, files]]), autoMatch);
        const stale = flags.staleMergeSources.get('merge') ?? new Set<string>();
        const plan = planMergeSourceUpdates(
          sources, stale, new Map([[700, files]]), mergeSourceFileIds([merge]), autoMatch,
        );
        const resolved = new Set(plan.resolved.flatMap((entry) => entry.sources.map((entry) => entry.fileName)));
        expect([name, autoMatch, resolved]).toEqual([name, autoMatch, flags.updatableMergeSources.get('merge') ?? new Set()]);
      }
    }
  });
});

describe('mergeSourceModIds', () => {
  it('dedupes by GameBanana id and keeps each source section', () => {
    const ids = mergeSourceModIds([
      source({ gameBananaId: 700, section: 'Mod' }),
      source({ gameBananaId: 700, section: 'Mod' }),
      source({ gameBananaId: 800, section: 'Sound' }),
      source({ gameBananaId: undefined }),
    ]);

    expect([...ids.entries()]).toEqual([
      [700, 'Mod'],
      [800, 'Sound'],
    ]);
  });
});
