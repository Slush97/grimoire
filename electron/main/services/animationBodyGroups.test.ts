import { describe, expect, it } from 'vitest';
import { eventBodyGroupMapping, previewBodyChoice } from './animationBodyGroups';

// Seven's model, as decoded from the game.
const seven = {
  meshGroups: ['DEFAULT_@0_#&BASE', 'DEFAULT_@1_#&NO_GUN', 'DEFAULT_@2_#&NO_GUN_AND_SKELETON'],
  defaultMask: 1,
  keyValueText: `CitadelEventIDToBodyGroupMapping_t = 
\t{
\t\tm_mapIDToSettings = 
\t\t{
\t\t\tTAG_StormCloud_BODYGROUP = 
\t\t\t[
\t\t\t\t{
\t\t\t\t\tm_sBodyGroupName = "DEFAULT"
\t\t\t\t\tm_BodygroupChoice = "NO_GUN"
\t\t\t\t},
\t\t\t]
\t\t\tTAG_StormCloudSkeleton_BODYGROUP = 
\t\t\t[
\t\t\t\t{
\t\t\t\t\tm_sBodyGroupName = "DEFAULT"
\t\t\t\t\tm_BodygroupChoice = "NO_GUN_AND_SKELETON"
\t\t\t\t\tm_nPriority = 1
\t\t\t\t},
\t\t\t]
\t\t}
\t}
\tCPhysicsBodyGameMarkupData = 
\t{
\t\tm_list = [ 1, 2 ]
\t}`,
};
const id = (tag: string, start: number, duration: number) => ({ _class: 'CNmIDEvent', m_ID: tag, m_flStartTime: { m_flValue: start }, m_flDuration: { m_flValue: duration } });
const set = (bodygroup: string, value: number, start: number) => ({ _class: 'CNmLegacyEvent', m_animEventClassName: 'AE_BODYGROUP_SET_VALUE',
  m_KV: { bodygroup, value }, m_flStartTime: { m_flValue: start }, m_flDuration: { m_flValue: 0 } });

describe('eventBodyGroupMapping', () => {
  it('reads the tag table from the model key values and stops at the next block', () => {
    expect([...eventBodyGroupMapping(seven.keyValueText)]).toEqual([
      ['TAG_StormCloud_BODYGROUP', [{ group: 'default', choice: 'NO_GUN' }]],
      ['TAG_StormCloudSkeleton_BODYGROUP', [{ group: 'default', choice: 'NO_GUN_AND_SKELETON' }]],
    ]);
    expect(eventBodyGroupMapping('').size).toBe(0);
  });
});

describe('previewBodyChoice', () => {
  it('drops Seven\'s gun for his ult, ignoring the brief skeleton flashes', () => {
    const start = { durationSeconds: 1.3, events: [id('TAG_StormCloudSkeleton_BODYGROUP', 0, 0.025), id('TAG_StormCloud_BODYGROUP', 0, 1)] };
    const loop = { durationSeconds: 12.4, events: [id('TAG_StormCloud_BODYGROUP', 0, 1), id('TAG_StormCloudSkeleton_BODYGROUP', 0.3, 0.02)] };
    expect(previewBodyChoice([start, loop], seven)).toBe('NO_GUN');
  });

  it('follows set events by their group choice index, and keeps the default body for a brief swap', () => {
    const model = { meshGroups: ['default_@0_#&base', 'default_@1_#&reload_door_visible', 'head_@0_#&a', 'head_@1_#&b'], defaultMask: 0b0101, keyValueText: '' };
    expect(previewBodyChoice([{ durationSeconds: 2, events: [set('default', 1, 0.1), set('default', 0, 0.9)] }], model)).toBe('reload_door_visible');
    expect(previewBodyChoice([{ durationSeconds: 2, events: [set('default', 1, 0.6)] }], model)).toBeNull();
    expect(previewBodyChoice([{ durationSeconds: 2, events: [] }], model)).toBeNull();
  });
});
