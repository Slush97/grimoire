import type { MovementFxChoice } from './movementFx';

export const MOVEMENT_CYCLE = 3;
export const MOVEMENT_DISTANCE = 2.3;
const smooth = (t: number, start: number, end: number) => {
  const x = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return x * x * (3 - 2 * x);
};

/** One clock drives the actor, clip blending and effect replay. */
export function movementFrame(kind: MovementFxChoice['kind'], elapsed: number, loop: boolean) {
  const time = loop ? elapsed % MOVEMENT_CYCLE : elapsed;
  const charge = kind === 'heavy-melee' ? smooth(time, .35, .45) * (1 - smooth(time, .85, 1.05)) : 0;
  const punch = kind === 'heavy-melee' ? smooth(time, .85, 1.05) * (1 - smooth(time, 1.4, 1.65)) : 0;
  const dash = kind === 'dash' ? smooth(time, .4, .5) * (1 - smooth(time, .95, 1.15)) : 0;
  const dashBack = kind === 'dash' ? smooth(time, 2.1, 2.2) * (1 - smooth(time, 2.65, 2.85)) : 0;
  return { time, cycle: loop ? Math.floor(elapsed / MOVEMENT_CYCLE) : 0,
    standing: Math.max(0, 1 - charge - punch - dash - dashBack), charge, punch, dash, dashBack,
    chargeTime: Math.max(0, Math.min(.46, time - .35)),
    punchTime: Math.max(0, time - .85), dashTime: Math.max(0, time - .4), dashBackTime: Math.max(0, time - 2.1),
    distance: kind === 'dash' ? MOVEMENT_DISTANCE * smooth(time, .5, .9) * (1 - smooth(time, 2.2, 2.6)) : 0 };
}

/** Resolve naming and directory variants within this hero's resources. */
export function selectMovementClips(paths: readonly string[], entry: string, aliases: readonly string[] = [], embedded: readonly string[] = []): [string, string][] {
  const canonical = (name: string) => name.replace(/(?:_v\d+|_wip)$/, '');
  const hero = canonical(entry.split('/').at(-1)?.replace('.vmdl_c', '') ?? '');
  if (!hero) return [];
  const heroes = [hero, ...aliases];
  const candidates = paths.filter(path => path.endsWith('.vnmclip_c')
    && path.split('/').some(part => heroes.includes(canonical(part))));
  const filename = (path: string) => {
    const name = path.split('/').at(-1)?.replace('.vnmclip_c', '') ?? '';
    const prefix = heroes.find(value => name.startsWith(`${value}_`));
    return prefix ? name.slice(prefix.length + 1) : name;
  };
  const version = (path: string) => Math.max(0, ...[...path.matchAll(/_v(\d+)\//g)].map(match => Number(match[1])));
  const choose = (names: string[], preferredDir?: string) => candidates.filter(path => names.includes(filename(path)))
    .sort((a, b) => version(b) - version(a) || names.indexOf(filename(a)) - names.indexOf(filename(b))
      || Number(!!preferredDir && b.startsWith(preferredDir)) - Number(!!preferredDir && a.startsWith(preferredDir)) || a.localeCompare(b))[0]
      ?? names.filter(name => embedded.includes(name)).map(name => `legacy:${name}`)[0];
  const idle = choose(['weapon_stand_idle', 'primary_stand_idle', 'out_of_combat_stand_idle', 'outofcombat_stand_idle', 'stand_idle']);
  if (!idle) return [];
  const dir = idle.slice(0, idle.lastIndexOf('/') + 1);
  return [['standing', idle], ...[
    { action: 'charge', names: ['melee_start'] }, { action: 'punch', names: ['melee_hit'] },
    { action: 'dash', names: ['dash_air_forward', 'air_dash_forward', 'primary_airdash', 'dash_ground', 'ground_dash'] },
    { action: 'dashBack', names: ['dash_air_back', 'air_dash_back', 'dash_air_backward', 'primary_airdash_back', 'primary_airdash_bkward', 'dash_ground_back'] },
  ].flatMap(({ action, names }): [string, string][] => {
    const path = choose(names, dir);
    return path ? [[action, path]] : [];
  })];
}
