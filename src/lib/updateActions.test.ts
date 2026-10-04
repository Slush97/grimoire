import { describe, expect, it } from 'vitest';
import { decideFileDownload, resolveUpdateRun, sameFileModIds, summarizeUpdateScope } from './updateActions';
import { classifyModFiles, type InstalledUpdateEntry, type UpdateFileRow } from './updateFileMatch';
import snapshot from './__fixtures__/gamebanana/files-2026-10-02.json';

const rowsOf = (modId: number): UpdateFileRow[] => (snapshot as Record<string, UpdateFileRow[]>)[String(modId)];

const QOL = 650634;
const qolFiles = rowsOf(QOL);
const HOTFIX = 1833534;
const ANNOUNCER = 1680726;
const ADDON = 1627686;
const DELETED_MAIN = 1832204;

const vpk = (id: string, gameBananaFileId: number, over: Partial<InstalledUpdateEntry> = {}): InstalledUpdateEntry => ({
  id,
  gameBananaId: QOL,
  gameBananaFileId,
  ...over,
});

// A QOL Lock install as reported: the old main (since deleted), an announcer,
// and an archived optional addon whose two VPKs came from one archive.
const qolInstall = [
  vpk('main', DELETED_MAIN, { sourceFileName: 'qollock_403_30september' }),
  vpk('announcer', ANNOUNCER, { sourceFileName: 'optional_announcer_slot1_seven_josefumivo' }),
  vpk('addon-a', ADDON, { sourceFileName: 'optional_addon_neutral_icons' }),
  vpk('addon-b', ADDON, { sourceFileName: 'optional_addon_neutral_icons' }),
];

// The same install when the main matched nothing: a file only the user can map.
const unmatchedInstall = [
  vpk('main', DELETED_MAIN, { sourceFileName: 'my_renamed_upload' }),
  ...qolInstall.slice(1),
];

describe('summarizeUpdateScope', () => {
  it('labels the confident successor and reports the archived addon', () => {
    const summary = summarizeUpdateScope(classifyModFiles(QOL, qolFiles, qolInstall));

    expect(summary).toEqual({
      flagged: true,
      archived: true,
      targets: new Map([[HOTFIX, ['main']]]),
      needsPick: [],
    });
  });

  it('labels nothing as an update when the stale file has no successor', () => {
    // Before: every current file read "Update" in this situation.
    const summary = summarizeUpdateScope(classifyModFiles(QOL, qolFiles, unmatchedInstall));

    expect(summary.targets.size).toBe(0);
    expect(summary.needsPick).toEqual([DELETED_MAIN]);
    expect(summary.flagged).toBe(true);
  });

  it('only looks at the files in scope', () => {
    const summary = summarizeUpdateScope(classifyModFiles(QOL, qolFiles, qolInstall), new Set([ADDON]));

    expect(summary).toEqual({ flagged: false, archived: true, targets: new Map(), needsPick: [] });
  });
});

describe('decideFileDownload', () => {
  const resolved = classifyModFiles(QOL, qolFiles, qolInstall);
  const unmatched = classifyModFiles(QOL, qolFiles, unmatchedInstall);

  it.each([
    { archived: true, descriptions: true },
    { archived: true, descriptions: false },
    { archived: false, descriptions: true },
    { archived: false, descriptions: false },
  ])('preserves a red variant when only blue remains: %j', ({ archived, descriptions }) => {
    const installed = [vpk('red', 10, {
      sourceFileName: 'mina_red_v1',
      fileDescription: descriptions ? 'Mina 红色' : undefined,
    })];
    const files: UpdateFileRow[] = [{
      id: 20, fileName: 'mina_v2_blue.zip', isArchived: false, dateAdded: 100_000,
      description: descriptions ? 'Mina 蓝色' : undefined,
    }];
    if (archived) files.push({
      id: 10, fileName: 'mina_red_v1.zip', isArchived: true, dateAdded: 1000,
      description: installed[0].fileDescription,
    });
    const classification = classifyModFiles(QOL, files, installed);

    expect(classification.states.get(10)).toEqual({ kind: archived ? 'archived' : 'needs-pick' });
    expect(summarizeUpdateScope(classification).targets.size).toBe(0);
    expect(resolveUpdateRun(classification, installed)).toEqual([
      { modId: 'red', kind: archived ? 'skip' : 'needs-pick' },
    ]);
    expect(decideFileDownload(20, classification, installed)).toEqual({
      kind: 'install', replacedModIds: [],
    });
    if (!archived) {
      expect(decideFileDownload(20, classification, installed, { replaceFileId: 10 })).toEqual({
        kind: 'replace', replacedModIds: ['red'],
      });
    }
  });

  it('replaces only the stale file when its confident successor is picked', () => {
    expect(decideFileDownload(HOTFIX, resolved, qolInstall)).toEqual({ kind: 'update', replacedModIds: ['main'] });
  });

  it('installs a current file without deleting anything when the stale file has no successor', () => {
    expect(decideFileDownload(HOTFIX, unmatched, unmatchedInstall)).toEqual({ kind: 'install', replacedModIds: [] });
  });

  it('reinstalls an installed file without touching the stale one', () => {
    // Before: clicking a file you already had, labelled "Update", deleted the
    // stale file without downloading anything.
    expect(decideFileDownload(ANNOUNCER, unmatched, unmatchedInstall)).toEqual({
      kind: 'reinstall',
      replacedModIds: ['announcer'],
    });
  });

  it('never deletes an archived file on a plain click of another row', () => {
    const decisions = qolFiles
      .filter((file) => file.id !== ADDON)
      .map((file) => decideFileDownload(file.id, resolved, qolInstall));

    for (const decision of decisions) {
      expect(decision.replacedModIds).not.toContain('addon-a');
      expect(decision.replacedModIds).not.toContain('addon-b');
    }
    expect(decideFileDownload(ADDON, resolved, qolInstall)).toEqual({
      kind: 'reinstall',
      replacedModIds: ['addon-a', 'addon-b'],
    });
  });

  it('deletes exactly the named file on a confirmed replace', () => {
    expect(decideFileDownload(HOTFIX, unmatched, unmatchedInstall, { replaceFileId: DELETED_MAIN })).toEqual({
      kind: 'replace',
      replacedModIds: ['main'],
    });
  });

  it('refuses a replace of an archived file and falls back to a plain install', () => {
    expect(decideFileDownload(HOTFIX, unmatched, unmatchedInstall, { replaceFileId: ADDON })).toEqual({
      kind: 'install',
      replacedModIds: [],
    });
  });

  it('refuses to replace with an archived row', () => {
    const decision = decideFileDownload(1627687, unmatched, unmatchedInstall, { replaceFileId: DELETED_MAIN });

    expect(decision).toEqual({ kind: 'install', replacedModIds: [] });
  });

  it('ignores updates and replacements for stale files outside the scope', () => {
    const scope = new Set([ANNOUNCER]);

    expect(decideFileDownload(HOTFIX, resolved, qolInstall, { scopeFileIds: scope })).toEqual({
      kind: 'install',
      replacedModIds: [],
    });
    expect(
      decideFileDownload(HOTFIX, unmatched, unmatchedInstall, { scopeFileIds: scope, replaceFileId: DELETED_MAIN }),
    ).toEqual({ kind: 'install', replacedModIds: [] });
  });

  it('never replaces a VPK the user set to ignore updates', () => {
    const installed = [vpk('main-a', DELETED_MAIN, { sourceFileName: 'qollock_403_30september' }), vpk('main-b', DELETED_MAIN, { ignoreUpdates: true })];

    expect(decideFileDownload(HOTFIX, classifyModFiles(QOL, qolFiles, installed), installed)).toEqual({
      kind: 'update',
      replacedModIds: ['main-a'],
    });
  });
});

describe('resolveUpdateRun', () => {
  it('downloads the successor of the stale main and leaves the archived addon out of the batch', () => {
    const steps = resolveUpdateRun(classifyModFiles(QOL, qolFiles, qolInstall), qolInstall);

    expect(steps).toEqual([
      { modId: 'main', kind: 'update', fileId: HOTFIX, promote: false },
      { modId: 'announcer', kind: 'skip' },
      { modId: 'addon-a', kind: 'skip' },
      { modId: 'addon-b', kind: 'skip' },
    ]);
  });

  it('queues a deleted file without a successor for a manual pick', () => {
    const steps = resolveUpdateRun(classifyModFiles(QOL, qolFiles, unmatchedInstall), unmatchedInstall.slice(0, 1));

    expect(steps).toEqual([{ modId: 'main', kind: 'needs-pick' }]);
  });

  it('never batches Top Bar Plus killstreak_fx onto v5, the sole current file', () => {
    const files = rowsOf(623518);
    const installed = [
      { id: 'killstreak', gameBananaId: 623518, gameBananaFileId: 1614618, sourceFileName: 'killstreak_fx' },
      { id: 'top-bar', gameBananaId: 623518, gameBananaFileId: 1769092, sourceFileName: 'v40d_top_bar_plus' },
    ];

    expect(resolveUpdateRun(classifyModFiles(623518, files, installed), installed)).toEqual([
      { modId: 'killstreak', kind: 'skip' },
      { modId: 'top-bar', kind: 'update', fileId: 1834013, promote: false },
    ]);
  });

  it('skips ignored, unknown and current files', () => {
    const installed = [
      vpk('ignored', DELETED_MAIN, { sourceFileName: 'qollock_403_30september', ignoreUpdates: true }),
      vpk('current', HOTFIX),
    ];
    const classification = classifyModFiles(QOL, qolFiles, installed);

    expect(resolveUpdateRun(classification, [...installed, vpk('other-mod', 5, { gameBananaId: 1 })])).toEqual([
      { modId: 'ignored', kind: 'skip' },
      { modId: 'current', kind: 'skip' },
      { modId: 'other-mod', kind: 'skip' },
    ]);
  });
});

describe('a successor the user already installed', () => {
  // A one-click, Browse grid or collection install of the hotfix leaves the
  // deleted old main beside it.
  const installed = [
    vpk('main', DELETED_MAIN, { sourceFileName: 'qollock_403_30september' }),
    vpk('hotfix', HOTFIX, { sourceFileName: 'qollock403_1octoberhotfix' }),
  ];
  const classification = classifyModFiles(QOL, qolFiles, installed);

  it('labels the installed hotfix as the update and promotes it in Update all', () => {
    expect(summarizeUpdateScope(classification, new Set([DELETED_MAIN])).targets).toEqual(new Map([[HOTFIX, ['main']]]));
    expect(resolveUpdateRun(classification, installed.slice(0, 1))).toEqual([
      { modId: 'main', kind: 'update', fileId: HOTFIX, promote: true },
    ]);
  });

  it('replaces only the old main when the installed hotfix row is clicked', () => {
    expect(decideFileDownload(HOTFIX, classification, installed, { scopeFileIds: new Set([DELETED_MAIN]) })).toEqual({
      kind: 'update',
      replacedModIds: ['main'],
    });
  });

  it('lets a confirmed replace target an installed current file (677044 feet v4 beside v5)', () => {
    const files = [{ id: 1774719, fileName: 'freaky_hidout.zip', isArchived: false }];
    const feet = [
      { id: 'feet-v4', gameBananaId: 677044, gameBananaFileId: 1723227, fileDescription: 'Feet in hub V4', sourceFileName: 'feetinhubv4' },
      { id: 'feet-v5', gameBananaId: 677044, gameBananaFileId: 1774719 },
    ];
    const feetClassification = classifyModFiles(677044, files, feet);

    expect(feetClassification.states.get(1723227)).toEqual({ kind: 'needs-pick' });
    expect(decideFileDownload(1774719, feetClassification, feet, { replaceFileId: 1723227 })).toEqual({
      kind: 'replace',
      replacedModIds: ['feet-v4'],
    });
    // A plain click on the installed v5 is still only a reinstall of v5.
    expect(decideFileDownload(1774719, feetClassification, feet)).toEqual({
      kind: 'reinstall',
      replacedModIds: ['feet-v5'],
    });
  });
});

describe('sameFileModIds', () => {
  it('returns every VPK of the same GameBanana file', () => {
    const mods = [vpk('a', 1), vpk('b', 1), vpk('c', 2), { id: 'local' }];

    expect(sameFileModIds(mods, 'a')).toEqual(['a', 'b']);
    expect(sameFileModIds(mods, 'local')).toEqual(['local']);
  });
});
