import { heroAnimationRecipe } from './heroAnimationCatalog';

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
export function groupHeroClips(clips: string[], heroName?: string): { group: HeroClipGroup; clips: string[] }[] {
  const groups: Record<HeroClipGroup, string[]> = { idle: [], movement: [], combat: [], other: [] };
  for (const name of clips) {
    const tokens = name.toLowerCase().split(/[^a-z0-9]+/);
    const reviewed = heroAnimationRecipe(name, heroName);
    const group = reviewed && ['idle', 'relaxedIdle', 'heroPose'].includes(reviewed.action) ? 'idle'
      : tokens.some((s) => /^(attack|fire|shoot|reload|melee|punch|cast|ability|ult|ultimate)$/.test(s)) ? 'combat'
        : tokens.some((s) => /^(idle|menu|loadout|select)$/.test(s)) ? 'idle'
          : tokens.some((s) => /^(walk|run|sprint|jump|land|crouch|dash|slide|climb|move)(?:\d+)?$/.test(s)) ? 'movement'
            : 'other';
    groups[group].push(name);
  }
  return (Object.keys(groups) as HeroClipGroup[])
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, clips: groups[group] }));
}

type ClipText = (key: string, options?: Record<string, unknown>) => string;

/** Recipe roles drive labels. Unrecognized clips retain their meaningful words
 * instead of being silently renamed to an unrelated action. */
export function heroClipLabel(name: string, t: ClipText, heroName?: string): string {
  const action = heroAnimationRecipe(name, heroName)?.action;
  if (action === 'idle') return t('locker.pose.clipLabels.idle');
  if (action === 'relaxedIdle') return t('locker.pose.clipLabels.relaxedIdle');
  if (action === 'heroPose') return t('locker.pose.clipLabels.heroPose');
  if (action === 'running') return t('locker.pose.clipLabels.running');
  if (action === 'reload') return t('locker.pose.clipLabels.reload');
  const words = name.replace(/^.*[/\\]/, '').replace(/\.(?:vanim|vnmclip)(?:_c)?$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}
