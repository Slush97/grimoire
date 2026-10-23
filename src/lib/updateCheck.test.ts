import { describe, expect, it } from 'vitest';
import { computeUpdateFlags, mergeSourceInstalls, type UpdateCheckMod } from './updateCheck';
import { summarizeUpdateScope } from './updateActions';
import { classifyModFiles, type UpdateFileRow } from './updateFileMatch';
import type { MergedModSource } from '../types/mod';
import snapshot from './__fixtures__/gamebanana/files-2026-10-02.json';

const rowsOf = (modId: number): UpdateFileRow[] => (snapshot as Record<string, UpdateFileRow[]>)[String(modId)];

const QOL = 650634;
const TOP_BAR = 623518;
const rows = new Map([
  [QOL, rowsOf(QOL)],
  [TOP_BAR, rowsOf(TOP_BAR)],
]);

const mod = (id: string, gameBananaId: number, gameBananaFileId: number, over: Partial<UpdateCheckMod> = {}): UpdateCheckMod => ({
  id,
  gameBananaId,
  gameBananaFileId,
  ...over,
});

const mergeSource = (fileName: string, gameBananaId: number, gameBananaFileId: number): MergedModSource => ({
  fileName,
  modName: fileName,
  gameBananaId,
  gameBananaFileId,
  enabledAtMergeTime: true,
  priorityAtMergeTime: 1,
});

const mergedMod = (sources: MergedModSource[], over: Partial<UpdateCheckMod> = {}): UpdateCheckMod => ({
  id: 'merged',
  merged: { sources },
  ...over,
});

describe('computeUpdateFlags', () => {
  it('reclassifies an archived rename according to the remaining-file preference', () => {
    const files: UpdateFileRow[] = [
      { id: 1, fileName: 'old_name.zip', isArchived: true, dateAdded: 10_000 },
      { id: 2, fileName: 'renamed.zip', isArchived: false, dateAdded: 20_000 },
    ];
    const mods = [mod('old', QOL, 1, { sourceFileName: 'old_name' })];
    const rows = new Map([[QOL, files]]);
    expect(computeUpdateFlags(mods, rows, true).updatesAvailable).toEqual(new Set(['old']));
    expect(computeUpdateFlags(mods, rows, false).updatesAvailable.size).toBe(0);
  });

  it('flags the deleted QOL Lock main and none of the archived addons', () => {
    const mods = [
      mod('main', QOL, 1832204, { sourceFileName: 'qollock_403_30september' }),
      mod('announcer', QOL, 1680726),
      mod('addon-neutral', QOL, 1627686),
      mod('addon-sinners', QOL, 1627687),
      mod('addon-footsteps', QOL, 1631511),
    ];

    expect(computeUpdateFlags(mods, rows).updatesAvailable).toEqual(new Set(['main']));
  });

  it('flags nothing for the reported install: current main, announcers and archived addons', () => {
    const mods = [1833534, 1680726, 1641691, 1627686, 1627687, 1631511].map((fileId) => mod(`f${fileId}`, QOL, fileId));

    expect(computeUpdateFlags(mods, rows).updatesAvailable.size).toBe(0);
  });

  it('flags every VPK of a stale file except the ones set to ignore updates', () => {
    const mods = [
      mod('top-a', TOP_BAR, 1769092, { sourceFileName: 'v40d_top_bar_plus' }),
      mod('top-b', TOP_BAR, 1769092, { sourceFileName: 'v40d_top_bar_plus' }),
      mod('top-c', TOP_BAR, 1769092, { sourceFileName: 'v40d_top_bar_plus', ignoreUpdates: true }),
      mod('killstreak', TOP_BAR, 1614618, { sourceFileName: 'killstreak_fx' }),
    ];

    expect(computeUpdateFlags(mods, rows).updatesAvailable).toEqual(new Set(['top-a', 'top-b']));
  });

  it('skips mods whose file rows were not fetched', () => {
    expect(computeUpdateFlags([mod('x', 12345, 1)], rows).updatesAvailable.size).toBe(0);
  });

  it('reports stale merge sources with the same rules', () => {
    const merged = mergedMod([
      mergeSource('top_bar_dir.vpk', TOP_BAR, 1769092),
      mergeSource('killstreak_dir.vpk', TOP_BAR, 1614618),
      mergeSource('main_dir.vpk', QOL, 1832204),
      mergeSource('addon_dir.vpk', QOL, 1627686),
      mergeSource('hand_placed.vpk', QOL, 0),
    ]);

    // The QOL Lock source has no captured filename, and the hotfix is not the
    // sole current file, so it needs a pick: still reported as stale.
    expect(computeUpdateFlags([merged], rows).staleMergeSources).toEqual(
      new Map([['merged', new Set(['top_bar_dir.vpk', 'main_dir.vpk'])]]),
    );
  });

  it('reports only the stale merge sources that have a file to download as updatable', () => {
    const merged = mergedMod([
      mergeSource('top_bar_dir.vpk', TOP_BAR, 1769092),
      mergeSource('main_dir.vpk', QOL, 1832204),
    ]);

    // main_dir.vpk needs a manual pick, so it is flagged but cannot be updated.
    expect(computeUpdateFlags([merged], rows).updatableMergeSources).toEqual(
      new Map([['merged', new Set(['top_bar_dir.vpk'])]]),
    );
  });

  it('does not report a merge source whose successor is installed standalone', () => {
    const merged = mergedMod([mergeSource('top_bar_dir.vpk', TOP_BAR, 1769092)]);
    const standaloneV5 = mod('v5', TOP_BAR, 1834013);

    // v5 is the only successor and the user already has it, so the merge
    // source reads as archived rather than an update to re-download.
    expect(computeUpdateFlags([merged, standaloneV5], rows).staleMergeSources.size).toBe(0);
  });

  it('never offers a standalone file a successor the user has inside a merge', () => {
    // v40d's successor v5 is absorbed into a merge: downloading v5 standalone
    // would duplicate it, so v40d reads as archived and is not flagged.
    const mods = [
      mod('v40d', TOP_BAR, 1769092, { sourceFileName: 'v40d_top_bar_plus' }),
      mergedMod([mergeSource('v5_dir.vpk', TOP_BAR, 1834013)]),
    ];

    expect(computeUpdateFlags(mods, rows).updatesAvailable.has('v40d')).toBe(false);
  });

  it('does not hand one upload to both a merged source and a standalone install', () => {
    // Author archived `red` and deleted `blue`; the only current upload is unrelated.
    // `red` lives in a merge and `blue` is installed on its own. Each looks like the
    // single unmatched install of the mod when classified apart.
    const files: UpdateFileRow[] = [
      { id: 1, fileName: 'skin_red.zip', isArchived: true },
      { id: 3, fileName: 'voicelines_pack.zip', isArchived: false },
    ];
    const rows = new Map([[QOL, files]]);
    const merged = mergedMod([mergeSource('red_dir.vpk', QOL, 1)]);
    const blue = mod('blue', QOL, 2);
    const mods = [merged, blue];

    for (const autoMatch of [true, false]) {
      const flags = computeUpdateFlags(mods, rows, autoMatch);
      expect(flags.updatableMergeSources.size).toBe(0);
      expect(flags.staleMergeSources.size).toBe(0);
      const standalone = classifyModFiles(QOL, files, [blue], mergeSourceInstalls(mods), autoMatch);
      expect(standalone.states.get(2)).toEqual({ kind: 'needs-pick' });
      expect(summarizeUpdateScope(standalone).targets.size).toBe(0);
    }
    // On its own the deleted install is paired with the sole upload.
    const alone = classifyModFiles(QOL, files, [blue], [], true);
    expect(summarizeUpdateScope(alone).targets.has(3)).toBe(true);
  });

  it('does not let a merge with updates turned off compete for an upload', () => {
    const files: UpdateFileRow[] = [
      { id: 1, fileName: 'skin_red.zip', isArchived: true },
      { id: 3, fileName: 'voicelines_pack.zip', isArchived: false },
    ];
    const mods = [mergedMod([mergeSource('red_dir.vpk', QOL, 1)], { ignoreUpdates: true }), mod('blue', QOL, 2)];

    expect(computeUpdateFlags(mods, new Map([[QOL, files]]), true).updatesAvailable).toEqual(new Set(['blue']));
    const standalone = classifyModFiles(QOL, files, [mods[1]], mergeSourceInstalls(mods), true);
    expect(summarizeUpdateScope(standalone).targets.has(3)).toBe(true);
  });

  it('honours ignoreUpdates on a merged mod', () => {
    const merged = mergedMod([mergeSource('top_bar_dir.vpk', TOP_BAR, 1769092)], { ignoreUpdates: true });

    expect(computeUpdateFlags([merged], rows).staleMergeSources.size).toBe(0);
  });
});
