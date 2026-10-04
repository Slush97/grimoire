import { describe, expect, it } from 'vitest';
import { mergeSourceModIds, planMergeSourceUpdates } from './mergeSourceUpdate';
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

describe('planMergeSourceUpdates', () => {
  it('matches the replacement by filename token overlap', () => {
    const files = [
      file(1000, 'galaxy_rem_gold_v1.zip', true),
      file(1001, 'galaxy_rem_gold_08_12.zip'),
      file(1002, 'totally_different_thing.zip'),
    ];

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

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

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved).toEqual([{ source: source(), reason: 'no-match' }]);
  });

  it('leaves a deleted source with nothing to go on unresolved', () => {
    // A merge records no filename or description, so a deleted source has no
    // signal at all; the sole current file is not assumed to replace it.
    const plan = planMergeSourceUpdates([source()], new Map([[700, [file(1500, 'all_in_one.7z')]]]));

    expect(plan.unresolved).toEqual([{ source: source(), reason: 'no-match' }]);
  });

  it('never maps an archived source onto the single current file', () => {
    // Before: the single-current fallback swapped an archived addon for the
    // main file. An archived row is often a retired addon, not an old version.
    const files = [file(1000, 'optional_addon_icons.zip', true), file(1500, 'main_v3.zip')];

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

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

    const plan = planMergeSourceUpdates(sources, new Map([[700, files]]));

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

    const plan = planMergeSourceUpdates(sources, new Map([[700, files]]));

    expect(plan.resolved.map((entry) => [entry.sources[0].fileName, entry.fileId])).toEqual([
      ['a_dir.vpk', 1501],
      ['b_dir.vpk', 1500],
    ]);
  });

  it('respects file ids already claimed outside the plan', () => {
    const files = [file(1500, 'only_current.zip')];

    const plan = planMergeSourceUpdates(
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

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved[0].reason).toBe('no-match');
  });

  it('flags sources with no recorded provenance', () => {
    const noIds = source({ gameBananaId: undefined, gameBananaFileId: undefined });

    const plan = planMergeSourceUpdates([noIds], new Map());

    expect(plan.unresolved).toEqual([{ source: noIds, reason: 'no-provenance' }]);
  });

  it('flags sources whose file list could not be fetched', () => {
    const plan = planMergeSourceUpdates([source()], new Map());

    expect(plan.unresolved).toEqual([{ source: source(), reason: 'files-unavailable' }]);
  });

  it('carries the source section through so the download hits the right endpoint', () => {
    const files = [file(1000, 'voice_pack_v1.zip', true), file(1500, 'voice_pack_v2.zip')];

    const plan = planMergeSourceUpdates(
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

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

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

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

    expect(plan.resolved).toEqual([]);
    expect(plan.unresolved[0].reason).toBe('no-match');
  });

  it('resolves every VPK cut from one stale file together, so it downloads once', () => {
    const files = [file(1000, 'pack_v1.zip', true), file(1500, 'pack_v2.zip'), file(1501, 'extras.zip')];
    const sources = [
      source({ fileName: 'pak10_dir.vpk', gameBananaFileId: 1000 }),
      source({ fileName: 'pak11_dir.vpk', gameBananaFileId: 1000 }),
    ];

    const plan = planMergeSourceUpdates(sources, new Map([[700, files]]));

    expect(plan.resolved).toEqual([
      { sources, gameBananaId: 700, fileId: 1500, fileName: 'pack_v2.zip', section: 'Mod' },
    ]);
    expect(plan.unresolved).toEqual([]);
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
