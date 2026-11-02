import { describe, expect, it } from 'vitest';
import { hideoutWarmingProgress, roomStageProgress } from './hideoutProgress';

describe('hideout warming progress', () => {
  it('runs the build, then the room, without going back', () => {
    const build = hideoutWarmingProgress({ building: true, built: false, build: 1, room: 0 })!;
    const room = hideoutWarmingProgress({ building: false, built: true, build: null, room: 0 })!;
    expect(room).toBe(build);
    expect(hideoutWarmingProgress({ building: false, built: true, build: null, room: 1 })).toBe(1);
  });
  it('fills the whole bar with the room when no build ran', () => {
    expect(hideoutWarmingProgress({ building: false, built: false, build: null, room: roomStageProgress('compiled') })).toBe(0.9);
  });
  it('reports no position for a build without progress', () => {
    expect(hideoutWarmingProgress({ building: true, built: false, build: null, room: 0 })).toBeNull();
    expect(roomStageProgress('unknown')).toBe(0);
  });
});
