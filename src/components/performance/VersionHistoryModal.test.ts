import { describe, expect, it } from 'vitest';
import type { PerformanceRemoteVersion } from '../../types/electron';
import { performanceHistoryRowCopy } from '../../lib/performanceHistory';

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
