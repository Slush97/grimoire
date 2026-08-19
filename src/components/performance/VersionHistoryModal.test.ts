import { describe, expect, it } from 'vitest';
import type { PerformancePresetVersion, PerformanceRemoteVersion } from '../../types/electron';
import {
  bundledPerformanceVersionFor,
  performanceHistoryRowCopy,
} from '../../lib/performanceHistory';

function entry(label: string | null, ref = '96ff42d1'): PerformanceRemoteVersion {
  return {
    ref,
    version: ref,
    commit: ref.padEnd(40, '0'),
    date: '2026-08-17',
    label,
  };
}

describe('performanceHistoryRowCopy', () => {
  it('promotes a prose release number and removes it from the detail', () => {
    expect(performanceHistoryRowCopy(entry('2.9.1 release'))).toEqual({
      primary: '2.9.1',
      detail: 'release',
    });
  });

  it('uses the known bundled version when its commit message has no version', () => {
    expect(performanceHistoryRowCopy(entry('readme update'), '2.8.2')).toEqual({
      primary: '2.8.2',
      detail: 'readme update',
    });
  });

  it('keeps the short commit when no release number is known', () => {
    expect(performanceHistoryRowCopy(entry('minor documentation update', 'be2d3889'))).toEqual({
      primary: 'be2d3889',
      detail: 'minor documentation update',
    });
  });
});

describe('bundledPerformanceVersionFor', () => {
  it('matches a prose history row by the commit that touched its config path', () => {
    const remote = entry('2.9 update', '9c3517c7');
    const bundled: PerformancePresetVersion = {
      version: '2.9',
      ref: '2.9',
      refKind: 'prose',
      commit: '96ff42d1db29ca9fe44afb3df749fa763bb87b87',
      historyCommit: remote.commit!,
      date: '2026-08-17',
      settingCount: 282,
      optIn: [],
    };

    expect(bundledPerformanceVersionFor(remote, [bundled])).toBe('2.9');
  });
});
