import { describe, expect, it } from 'vitest';
import { clampAnimationTime, clampPlaybackSpeed, groupHeroClips, heroClipLabel } from './heroViewerPlayback';

describe('viewer playback bounds', () => {
  it('clamps seeks without wrapping the final pose or accepting invalid time', () => {
    expect(clampAnimationTime(-5, 3)).toBe(0);
    expect(clampAnimationTime(10, 3)).toBe(3);
    expect(clampAnimationTime(2.4, 3)).toBe(2.4);
    expect(clampAnimationTime(NaN, 3)).toBe(0);
    expect(clampAnimationTime(Infinity, 3)).toBe(0);
    expect(clampAnimationTime(1, Infinity)).toBe(0);
    expect(clampAnimationTime(1, -1)).toBe(0);
  });

  it('keeps playback finite and within a bounded positive range', () => {
    expect(clampPlaybackSpeed(NaN)).toBe(1);
    expect(clampPlaybackSpeed(Infinity)).toBe(1);
    expect(clampPlaybackSpeed(-1)).toBe(0.1);
    expect(clampPlaybackSpeed(100)).toBe(4);
    expect(clampPlaybackSpeed(0.5)).toBe(0.5);
  });

  it('groups representative motions without dropping unknown authored clips', () => {
    const clips = ['stand_idle', 'run_forward', 'reload_fast', 'custom_motion', 'handstand', 'menu_idle', 'stand_attack'];
    const groups = groupHeroClips(clips);
    expect(groups).toEqual([
      { group: 'idle', clips: ['stand_idle', 'menu_idle'] },
      { group: 'movement', clips: ['run_forward'] },
      { group: 'combat', clips: ['reload_fast', 'stand_attack'] },
      { group: 'other', clips: ['custom_motion', 'handstand'] },
    ]);
    expect(groups.flatMap((group) => group.clips).sort()).toEqual([...clips].sort());
    expect(groupHeroClips([])).toEqual([]);
  });

  it('recognizes authored speed suffixes on Mirage and Yamato run clips', () => {
    expect(groupHeroClips(['primary_run355_n', 'primary_run275_e', 'item_run_600_n', 'runaway', 'runner'])).toEqual([
      { group: 'movement', clips: ['primary_run355_n', 'primary_run275_e', 'item_run_600_n'] },
      { group: 'other', clips: ['runaway', 'runner'] },
    ]);
  });

  it('labels reviewed actions and preserves meaningful unknown names', () => {
    const t = (key: string) => key;
    expect(heroClipLabel('primary_stand_idle', t)).toBe('locker.pose.clipLabels.idle');
    expect(heroClipLabel('ui_shop', t, 'Rem')).toBe('locker.pose.clipLabels.heroPose');
    expect(heroClipLabel('hero_pose', t, 'Dynamo')).toBe('locker.pose.clipLabels.heroPose');
    expect(heroClipLabel('item_run_n', t, 'Wraith')).toBe('locker.pose.clipLabels.running');
    expect(heroClipLabel('primary_stand_reload', t, 'Yamato')).toBe('locker.pose.clipLabels.reload');
    expect(heroClipLabel('custom_motion_right', t)).toBe('Custom motion right');
    expect(groupHeroClips(['primary_crouch_walk_reload', 'ui_shop'], 'Rem')).toEqual([
      { group: 'idle', clips: ['ui_shop'] },
      { group: 'combat', clips: ['primary_crouch_walk_reload'] },
    ]);
  });
});
