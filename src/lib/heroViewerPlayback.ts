export interface HeroPlaybackProgress {
  time: number;
  duration: number;
}

export interface HeroPlaybackSeek {
  time: number;
  revision: number;
}

/** Seeks never replay elapsed physics or accept invalid exporter durations. */
export function clampAnimationTime(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(duration, time));
}

export function clampPlaybackSpeed(speed: number): number {
  return Number.isFinite(speed) ? Math.max(0.1, Math.min(4, speed)) : 1;
}

export type HeroClipGroup = 'idle' | 'movement' | 'combat' | 'other';

/** Keep authored names, using conservative groups rather than hiding clips. */
export function groupHeroClips(clips: string[]): { group: HeroClipGroup; clips: string[] }[] {
  const groups: Record<HeroClipGroup, string[]> = { idle: [], movement: [], combat: [], other: [] };
  for (const name of clips) {
    const tokens = name.toLowerCase().split(/[^a-z0-9]+/);
    const group = tokens.some((s) => /^(idle|menu|loadout|select)$/.test(s)) ? 'idle'
      : tokens.some((s) => /^(walk|run|sprint|jump|land|crouch|dash|slide|climb|move)(?:\d+)?$/.test(s)) ? 'movement'
        : tokens.some((s) => /^(attack|fire|shoot|reload|melee|punch|cast|ability|ult|ultimate)$/.test(s)) ? 'combat'
          : 'other';
    groups[group].push(name);
  }
  return (Object.keys(groups) as HeroClipGroup[])
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, clips: groups[group] }));
}
