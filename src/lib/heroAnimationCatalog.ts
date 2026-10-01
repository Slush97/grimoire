export interface HeroAnimationInfo {
  name: string;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  looping: boolean;
  default: boolean;
  additive?: boolean;
  hidden?: boolean;
  delta?: boolean;
  requiresBase?: boolean;
  transition?: boolean;
  rootMotion?: boolean;
  standalone?: boolean;
}

export type HeroAnimationAction = 'idle' | 'relaxedIdle' | 'heroPose' | 'running' | 'reload';
export interface HeroAnimationRecipe {
  names: readonly string[];
  action: HeroAnimationAction;
  playback: 'loop' | 'hold';
}

const recipe = (action: HeroAnimationAction, names: readonly string[], playback: 'loop' | 'hold' = 'loop'): HeroAnimationRecipe => ({ action, names, playback });

/** Reviewed legacy sequences, informed by the installed hero UI graphs.
 * These are whole actions, not a reconstruction of gameplay graph layers.
 * See docs/hero-animation-selection.md for source and render limitations. */
export const HERO_ANIMATION_RECIPES: Readonly<Record<string, readonly HeroAnimationRecipe[]>> = {
  Dynamo: [recipe('idle', ['primary_stand_idle']), recipe('heroPose', ['hero_pose'], 'hold'), recipe('reload', ['primary_stand_reload'], 'hold')],
  Wraith: [recipe('idle', ['ui_shop_idle', 'primary_stand_idle']), recipe('heroPose', ['ui_hero_select'], 'hold'), recipe('running', ['item_run_n']), recipe('reload', ['primary_stand_reload'], 'hold')],
  Mirage: [recipe('relaxedIdle', ['primary_ooc_stand_idle']), recipe('heroPose', ['ui_main_menu'], 'hold')],
  Yamato: [recipe('heroPose', ['ui_hero_select', 'primary_stand_idle'], 'hold'), recipe('reload', ['primary_stand_reload'], 'hold')],
  Viscous: [recipe('idle', ['ui_hero_select', 'primary_stand_idle'])],
  Celeste: [recipe('idle', ['ui_shop', 'out_of_combat_stand_idle']), recipe('running', ['weapon_run_n'])],
  Rem: [recipe('heroPose', ['ui_shop'], 'hold')],
  Victor: [recipe('idle', ['weapon_stand_idle'])],
  Graves: [recipe('idle', ['weapon_stand_idle'])],
  'Infernus': [recipe('idle', ['shop_menu_base'], 'hold')],
  'Seven': [recipe('idle', ['primary_stand_idle'])],
  'Vindicta': [recipe('idle', ['primary_stand_idle'])],
  'Lady Geist': [recipe('idle', ['primary_stand_idle'])],
  'Abrams': [recipe('idle', ['shop_menu_base'])],
  'McGinnis': [recipe('idle', ['primary_shop_menu_idle']), recipe('reload', ['primary_stand_reload'], 'hold')],
  'Paradox': [recipe('idle', ['shop_menu_base']), recipe('reload', ['primary_stand_reload'], 'hold')],
  'Kelvin': [recipe('idle', ['primary_stand_idle']), recipe('running', ['item_run_n'])],
  'Haze': [recipe('idle', ['shop_menu_base']), recipe('reload', ['primary_stand_reload'], 'hold')],
  'Holliday': [recipe('idle', ['primary_stand_idle']), recipe('running', ['item_run_n'])],
  'Bebop': [recipe('idle', ['primary_stand_idle'])],
  'Calico': [recipe('idle', ['primary_stand_idle'], 'hold'), recipe('running', ['out_of_combat_run_n']), recipe('reload', ['primary_stand_reload'], 'hold')],
  'Grey Talon': [recipe('idle', ['shop_menu_base']), recipe('reload', ['primary_stand_reload'], 'hold')],
  'Mo & Krill': [recipe('idle', ['primary_stand_idle'])],
  'Shiv': [recipe('idle', ['primary_stand_idle'])],
  'Ivy': [recipe('idle', ['primary_stand_idle'])],
  'Warden': [recipe('idle', ['primary_stand_idle']), recipe('running', ['item_run_n'])],
  'Lash': [recipe('idle', ['primary_stand_idle'])],
  'Pocket': [recipe('idle', ['primary_stand_idle'])],
  'Vyper': [recipe('idle', ['primary_stand_idle']), recipe('running', ['primary_run_n'])],
  'Sinclair': [recipe('idle', ['primary_stand_idle'])],
  'Mina': [recipe('idle', ['weapon_stand_idle'])],
  'Drifter': [recipe('idle', ['ui_shop'])],
  'Venator': [recipe('idle', ['ui_shop'])],
  'Paige': [recipe('relaxedIdle', ['out_of_combat_stand_idle'])],
  'Doorman': [recipe('idle', ['primary_stand_idle'])],
  'Billy': [recipe('idle', ['primary_idle'], 'hold')],
  'Apollo': [recipe('idle', ['ui_shop'])],
  'Deadman Danny': [recipe('idle', ['ui_shop'])],
  'Silver': [recipe('idle', ['weapon_stand_idle']), recipe('running', ['out_of_combat_run_n'])],
  'Rat King': [recipe('idle', ['ui_shop_idle'])],
  'Solomon': [recipe('idle', ['ui_shop'])],
  'Violet': [recipe('idle', ['ui_shop'])],
  'Nurse Harrow': [recipe('idle', ['weapon_stand_idle1'])],
  'Baba': [recipe('relaxedIdle', ['outofcombat_stand_idle'])],
};

const STANDING_IDLE = ['primary_stand_idle', 'weapon_stand_idle', 'stand_idle', 'idle_stand', 'idle'] as const;
const RELAXED_IDLE = ['primary_ooc_stand_idle', 'out_of_combat_stand_idle', 'ooc_stand_idle'] as const;

/** Positive compiled metadata wins over a previously reviewed sequence name. */
export function isStandaloneHeroAnimation(clip: HeroAnimationInfo): boolean {
  if (!clip.name.trim() || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0.001
    || !Number.isFinite(clip.fps) || clip.fps <= 0 || !Number.isInteger(clip.frameCount) || clip.frameCount <= 1) return false;
  if (clip.standalone === false || clip.additive || clip.hidden || clip.delta || clip.requiresBase || clip.transition || clip.rootMotion) return false;
  const tokens = clip.name.toLowerCase().split(/[^a-z0-9]+/);
  return !tokens.some((token) => /^(?:aim|add|additive|delta|layer|blend|upperbody|lowerbody|transition|intro|exit|enter|end|start|channel|respawn|rebirth|death|flinch|retarget|bindpose|null)$/.test(token));
}

export function heroAnimationRecipe(name: string, heroName?: string): HeroAnimationRecipe | undefined {
  return (heroName ? HERO_ANIMATION_RECIPES[heroName] : undefined)?.find((r) => r.names.includes(name))
    ?? (STANDING_IDLE.includes(name as typeof STANDING_IDLE[number]) ? recipe('idle', [name]) : undefined)
    ?? (RELAXED_IDLE.includes(name as typeof RELAXED_IDLE[number]) ? recipe('relaxedIdle', [name]) : undefined)
    ?? (/^(?:ui_shop|ui_shop_idle|shop_ui_idle)$/.test(name) ? recipe('idle', [name]) : undefined)
    ?? (/^(?:ui_hero_pose|hero_pose|ui_hero_select|ui_main_menu)$/.test(name) ? recipe('heroPose', [name]) : undefined);
}

/** Unknown assets require explicit standalone metadata; raw category matches
 * are not sufficient to establish a complete action. */
export function selectHeroAnimations(clips: readonly HeroAnimationInfo[], heroName?: string): HeroAnimationInfo[] {
  const safe = clips.filter(isStandaloneHeroAnimation);
  const byName = new Map(safe.map((c) => [c.name, c]));
  const recipes = HERO_ANIMATION_RECIPES[heroName ?? ''] ?? [recipe('idle', STANDING_IDLE), recipe('relaxedIdle', RELAXED_IDLE), recipe('heroPose', ['hero_pose', 'ui_hero_pose'])];
  const selected: HeroAnimationInfo[] = [];
  let frames = 0;
  for (const r of recipes) {
    const clip = r.names.map((name) => byName.get(name)).find((c) => c && !selected.some((old) => old.name === c.name));
    if (!clip || frames + clip.frameCount > 10000) continue;
    selected.push(clip); frames += clip.frameCount;
  }
  // A reviewed default may disappear from a skin or game update. Try only a
  // complete neutral fallback, never the longest remaining gameplay layer.
  if (!selected.length) {
    const fallback = [...STANDING_IDLE, ...RELAXED_IDLE].map((n) => byName.get(n)).find(Boolean);
    if (fallback && fallback.frameCount <= 10000) { selected.push(fallback); frames += fallback.frameCount; }
  }
  for (const clip of safe.filter((c) => c.standalone === true).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (selected.length >= 8 || selected.some((c) => c.name === clip.name) || frames + clip.frameCount > 10000) continue;
    selected.push(clip); frames += clip.frameCount;
  }
  return selected;
}

export function preferredHeroAnimationName(names: readonly string[], heroName?: string): string | undefined {
  for (const r of HERO_ANIMATION_RECIPES[heroName ?? ''] ?? []) {
    const name = r.names.find((n) => names.includes(n));
    if (name) return name;
  }
  return [...STANDING_IDLE, ...RELAXED_IDLE, 'hero_pose', 'ui_hero_pose'].find((n) => names.includes(n)) ?? names[0];
}
