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

  it('falls back to the single remaining current file', () => {
    // Author consolidated everything into one upload, so token overlap with
    // the old name is worthless but the answer is unambiguous.
    const files = [file(1000, 'old_name.zip', true), file(1500, 'all_in_one.7z')];

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

    expect(plan.resolved[0]).toMatchObject({ fileId: 1500, fileName: 'all_in_one.7z' });
  });

  it('never lets two outdated sources claim the same replacement file', () => {
    // Both sources come from one GB mod and both are stale. Only one current
    // file exists, so exactly one can take it; guessing for the other would
    // swap unrelated content into the merge.
    const files = [
      file(1000, 'first_variant.zip', true),
      file(1001, 'second_variant.zip', true),
      file(1500, 'only_current.zip'),
    ];
    const sources = [
      source({ fileName: 'a_dir.vpk', gameBananaFileId: 1000 }),
      source({ fileName: 'b_dir.vpk', gameBananaFileId: 1001 }),
    ];

    const plan = planMergeSourceUpdates(sources, new Map([[700, files]]));

    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0].fileId).toBe(1500);
    expect(plan.unresolved).toEqual([{ source: sources[1], reason: 'no-match' }]);
  });

  it('respects file ids already claimed outside the plan', () => {
    const files = [file(1000, 'old.zip', true), file(1500, 'only_current.zip')];

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
    const files = [file(1000, 'old.zip', true), file(1500, 'new.zip')];

    const plan = planMergeSourceUpdates(
      [source({ section: 'Sound' })],
      new Map([[700, files]]),
    );

    expect(plan.resolved[0].section).toBe('Sound');
  });

  it('prefers an exact description match over filename overlap', () => {
    const files = [
      file(1000, 'pack_a.zip', true, 'Red variant'),
      file(1501, 'pack_a_updated.zip', false, 'Blue variant'),
      file(1502, 'completely_renamed.zip', false, 'Red variant'),
    ];

    const plan = planMergeSourceUpdates([source()], new Map([[700, files]]));

    expect(plan.resolved[0].fileId).toBe(1502);
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
