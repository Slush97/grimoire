import { describe, expect, it } from 'vitest';
import { isPerformanceConfigPath, standalonePerformanceAddons, suggestedPerformanceVideoPath } from './performanceRepository';

describe('performance repository layouts', () => {
  it('recognizes named gameinfo variants and pasted gameinfo.txt blocks', () => {
    expect(isPerformanceConfigPath('kaiz/gameinfo-EXTREME-LOW.gi')).toBe(true);
    expect(isPerformanceConfigPath('Deadlock Performance Config/gameinfo.txt')).toBe(true);
    expect(isPerformanceConfigPath('autoexec.cfg')).toBe(false);
    expect(isPerformanceConfigPath('convars.txt')).toBe(false);
  });

  it('pairs sibling and cfg/video.txt files without borrowing another preset’s settings', () => {
    expect(suggestedPerformanceVideoPath('Balanced/gameinfo.gi', ['Potato/video.txt'])).toBeNull();
    expect(suggestedPerformanceVideoPath('Balanced/gameinfo.gi', ['Balanced/cfg/video.txt', 'Potato/video.txt'])).toBe('Balanced/cfg/video.txt');
    expect(suggestedPerformanceVideoPath('gameinfo.gi', ['cfg/video.txt'])).toBe('cfg/video.txt');
  });

  it('prefers the conventional file but requires a choice between named variants', () => {
    expect(suggestedPerformanceVideoPath('Ultra/gameinfo.gi', ['Ultra/video.txt', 'Ultra/video(No Shadows).txt'])).toBe('Ultra/video.txt');
    expect(suggestedPerformanceVideoPath('Ultra/gameinfo.gi', ['Ultra/video(Shadows).txt', 'Ultra/video(No Shadows).txt'])).toBeUndefined();
    expect(suggestedPerformanceVideoPath('gameinfo.gi', ['video.txt', 'cfg/video.txt'])).toBeUndefined();
    expect(suggestedPerformanceVideoPath(null, ['video.txt'])).toBe('video.txt');
  });

  it('does not offer split chunks or their incomplete directory file as standalone addons', () => {
    const paths = ['addons/pak01_dir.vpk', 'addons/pak01_000.vpk', 'other/pak01_dir.vpk', 'addons/pak02_dir.vpk', 'addons/pak02_extra_000.vpk'];
    expect(standalonePerformanceAddons(paths.map((path) => ({ path, size: 1 }))).map((file) => file.path)).toEqual(['other/pak01_dir.vpk', 'addons/pak02_dir.vpk']);
  });
});
