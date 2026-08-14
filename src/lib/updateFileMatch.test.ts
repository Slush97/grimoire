import { describe, expect, it } from 'vitest';
import { hasPendingUpdate, planFileUpdates } from './updateFileMatch';
import type { GameBananaFile } from '../types/gamebanana';

const file = (id: number, fileName: string, isArchived = false): GameBananaFile => ({
  id,
  fileName,
  fileSize: 1,
  downloadUrl: `https://gamebanana.com/dl/${id}`,
  downloadCount: 0,
  isArchived,
});

const variant = (gameBananaFileId: number, gameBananaId = 650634) => ({
  gameBananaId,
  gameBananaFileId,
});

describe('hasPendingUpdate', () => {
  // The QOL Lock report: 9 files installed, then the author replaced the main
  // archive (qollock_319_30july.zip #1769081 -> qollock_319_31july.zip #1780000)
  // and the old row vanished from the listing entirely.
  const qolLockFiles = [
    file(1627686, 'optional_addon_neutral_icons.zip'),
    file(1627687, 'optional_addon_sinners_icon.zip'),
    file(1631511, 'optional_addon_footstep_occlusion.zip'),
    file(1680726, 'optional_announcer_slot1_seven_josefumivo.zip'),
    file(1641691, 'optional_announcer_slot2__graves_bregraham.zip'),
    file(1641703, 'optional_announcer_slot3_drifter_viewtifulvalentine.zip'),
    file(1641769, 'optional_announcer_slot4_viscous_josefumivo.zip'),
    file(1680727, 'optional_announcer_slot5_rem_zmpixie.zip'),
    file(1780000, 'qollock_319_31july.zip'),
  ];
  const qolLockInstalled = [
    variant(1769081), // the replaced main file, no longer in the listing
    variant(1627686),
    variant(1627687),
    variant(1631511),
    variant(1680726),
    variant(1641691),
    variant(1641703),
    variant(1641769),
    variant(1680727),
  ];

  it('flags a mod whose installed file the author replaced', () => {
    expect(hasPendingUpdate(650634, qolLockFiles, qolLockInstalled)).toBe(true);
  });

  it('does not flag a mod whose installed files are all still live', () => {
    const upToDate = qolLockInstalled.map((v) =>
      v.gameBananaFileId === 1769081 ? variant(1780000) : v
    );

    expect(hasPendingUpdate(650634, qolLockFiles, upToDate)).toBe(false);
  });

  it('flags a superseded file that was archived rather than deleted', () => {
    const files = [file(1, 'old.zip', true), file(2, 'new.zip')];

    expect(hasPendingUpdate(650634, files, [variant(1)])).toBe(true);
  });

  it('respects ignoreUpdates on the installed variant', () => {
    const files = [file(2, 'new.zip')];

    expect(hasPendingUpdate(650634, files, [{ ...variant(1), ignoreUpdates: true }])).toBe(false);
  });

  it('ignores variants belonging to a different mod', () => {
    const files = [file(2, 'new.zip')];

    expect(hasPendingUpdate(650634, files, [variant(1, 999999)])).toBe(false);
  });

  it('ignores custom imports and legacy installs with no file id', () => {
    const files = [file(2, 'new.zip')];

    expect(hasPendingUpdate(650634, files, [{ gameBananaId: 650634 }])).toBe(false);
    expect(hasPendingUpdate(650634, files, [variant(0)])).toBe(false);
  });

  it('treats an unloaded or fully archived file list as "unknown", not "outdated"', () => {
    expect(hasPendingUpdate(650634, [], [variant(1)])).toBe(false);
    expect(hasPendingUpdate(650634, [file(2, 'old.zip', true)], [variant(1)])).toBe(false);
  });
});

describe('planFileUpdates', () => {
  it('promotes an already-installed sole replacement for a stale sibling', () => {
    const files = [file(1774719, 'freaky_hidout.zip')];
    const installed = [
      {
        id: 'feet-v4',
        gameBananaId: 677044,
        gameBananaFileId: 1723227,
        installedFileId: 1723227,
        fileDescription: 'Feet in hub V4',
        sourceFileName: 'feetinhubv4',
      },
      {
        id: 'feet-v5',
        gameBananaId: 677044,
        gameBananaFileId: 1774719,
        installedFileId: 1774719,
      },
    ];

    const plan = planFileUpdates(677044, files, installed);
    expect(plan.sourcesByTargetFileId.get(1774719)).toEqual(['feet-v4']);
    expect(plan.unresolvedSourceIds).toEqual([]);
  });

  it('leaves a multi-file replacement unresolved when no candidate is confident', () => {
    const files = [file(2, 'gold.zip'), file(3, 'silver.zip')];
    const plan = planFileUpdates(10, files, [{
      id: 'old',
      gameBananaId: 10,
      gameBananaFileId: 1,
      installedFileId: 1,
      sourceFileName: 'unrelated.zip',
    }]);

    expect(plan.sourcesByTargetFileId.size).toBe(0);
    expect(plan.unresolvedSourceIds).toEqual(['old']);
  });

  it('marks only the matching replacement as an update, not alternate live variants', () => {
    const files = [
      { ...file(2, 'gold-v2.zip'), description: 'Gold' },
      { ...file(3, 'silver-v2.zip'), description: 'Silver' },
    ];
    const plan = planFileUpdates(10, files, [{
      id: 'old-gold',
      gameBananaId: 10,
      gameBananaFileId: 1,
      installedFileId: 1,
      fileDescription: 'Gold',
    }]);

    expect([...plan.sourcesByTargetFileId.keys()]).toEqual([2]);
    expect(plan.sourcesByTargetFileId.has(3)).toBe(false);
  });
});
