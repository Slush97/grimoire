import { z } from 'zod';

/**
 * What the game's own data says about a hero's heavy melee and dash, read from scripts/heroes.vdata and
 * scripts/abilities.vdata through the package stack (a mod that edits them changes this). Every field
 * names its source in `evidence`; nothing here is tuned per hero.
 */
export interface MovementGameData {
  /** The heroes.vdata entry, `hero_atlas`. */
  heroKey: string;
  melee: {
    /** The ability bound to ESlot_Weapon_Melee. */
    ability: string;
    /** m_strEffectsAttachName: the attachment the melee effects play on, or null when the ability names none. */
    attachment: string | null;
    /** m_HoldBeginEffect: plays while the button is held (the charge). */
    holdBegin: string | null;
    /** m_mapAttacks.EAttackType_Heavy.m_MeleeAttackParticle: plays as the heavy attack starts. */
    attack: string | null;
    /** m_mapAttacks.EAttackType_Heavy.m_MeleeSwingParticle: plays as the blow lands. */
    swing: string | null;
    /** m_mapAttacks.EAttackType_Heavy.m_MeleeImpactParticle: plays where the blow lands. */
    impact: string | null;
    /** m_MovementSpeedCurve of the heavy attack: how long the lunge lasts (seconds) and how far it carries (inches). */
    lunge: Lunge | null;
  } | null;
  dash: {
    /** The ability bound to ESlot_Ability_Innate_1. */
    ability: string;
    /** m_DashParticle. */
    particle: string | null;
    /** m_mapStartingStats.EAirDashDistanceInMeters, as inches. */
    distance: number;
    /** m_mapStartingStats.EAirDashDuration, seconds. */
    duration: number;
  } | null;
  evidence: string[];
}

/** A move over time: how long it lasts (seconds), how far it carries (inches) and the fraction covered at 16 even steps. */
export interface Lunge {
  duration: number;
  distance: number;
  profile: number[];
}

const INCHES_PER_METER = 1 / 0.0254;
const PARTICLE_PATH = /^particles\/[a-zA-Z0-9_./-]+\.vpcf$/;

type Table = Record<string, unknown>;
const tableSchema = z.record(z.unknown());

const isTable = (value: unknown): value is Table => value !== null && typeof value === 'object' && !Array.isArray(value);

function at(entry: unknown, path: readonly string[]): unknown {
  let value = entry;
  for (const key of path) value = isTable(value) ? value[key] : undefined;
  return value;
}

/**
 * A field of a vdata entry, else of its bases: `_multibase` (the later ones overriding the earlier) and
 * `_base`, as the vdata compiler resolves them. Bounded against cycles and runaway chains.
 */
export function inheritedField(table: Table, name: string, path: readonly string[], visited = new Set<string>()): { value: unknown; from: string } | undefined {
  if (visited.has(name) || visited.size >= 32 || !isTable(table[name])) return undefined;
  visited.add(name);
  const entry = table[name] as Table;
  const value = at(entry, path);
  if (value !== undefined) return { value, from: name };
  const multibase = Array.isArray(entry._multibase) ? entry._multibase.filter((base): base is string => typeof base === 'string') : [];
  const bases = [...multibase, ...(typeof entry._base === 'string' ? [entry._base] : [])].reverse();
  for (const base of bases) {
    const found = inheritedField(table, base, path, visited);
    if (found) return found;
  }
  return undefined;
}

interface SplineKey { x: number; y: number; slopeIn: number; slopeOut: number }

function splineKeys(curve: unknown): SplineKey[] {
  const keys = at(curve, ['m_spline']);
  return Array.isArray(keys)
    ? keys.filter(isTable).map((key) => ({ x: Number(key.x) || 0, y: Number(key.y) || 0, slopeIn: Number(key.m_flSlopeIncoming) || 0, slopeOut: Number(key.m_flSlopeOutgoing) || 0 }))
      .sort((a, b) => a.x - b.x)
    : [];
}

/** A piecewise cubic Hermite curve through the keys with their authored slopes, held flat outside them. */
export function evaluateSpline(keys: readonly SplineKey[], x: number): number {
  if (keys.length === 0) return 0;
  if (x <= keys[0].x) return keys[0].y;
  const last = keys[keys.length - 1];
  if (x >= last.x) return last.y;
  let i = 0;
  while (x > keys[i + 1].x) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.x - a.x;
  if (span <= 0) return b.y;
  const t = (x - a.x) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * span * a.slopeOut + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * span * b.slopeIn;
}

/** How long a speed curve runs (from 0 to its last key) and how far it carries (its integral), with the fraction covered at 16 even steps. */
export function speedCurveTravel(curve: unknown): Lunge | null {
  const keys = splineKeys(curve);
  if (keys.length < 2) return null;
  const duration = keys[keys.length - 1].x;
  if (!(duration > 0)) return null;
  const steps = 256;
  const h = duration / steps;
  const covered = [0];
  let distance = 0;
  // Trapezoids over a fine step: the curves are smooth and end in a steep drop to 0
  for (let i = 1; i <= steps; i++) {
    distance += ((Math.max(0, evaluateSpline(keys, (i - 1) * h)) + Math.max(0, evaluateSpline(keys, i * h))) / 2) * h;
    covered.push(distance);
  }
  if (!(distance > 0)) return null;
  const profile = Array.from({ length: 17 }, (_, i) => covered[(i * steps) / 16] / distance);
  return { duration, distance, profile };
}

const particle = (value: unknown): string | null => (typeof value === 'string' && PARTICLE_PATH.test(value) && !value.includes('..') ? value : null);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Resolves a hero's heavy melee and dash data, or null when heroes.vdata has no entry for any codename. */
export function resolveMovementGameData(heroesInput: unknown, abilitiesInput: unknown, codenames: readonly string[]): MovementGameData | null {
  const heroes = tableSchema.parse(heroesInput);
  const abilities = tableSchema.parse(abilitiesInput);
  const heroKey = codenames.map((codename) => `hero_${codename}`).find((key) => isTable(heroes[key]));
  if (!heroKey) return null;
  const evidence: string[] = [];
  const heroField = (path: readonly string[]) => {
    const found = inheritedField(heroes, heroKey, path);
    if (found) evidence.push(`heroes.vdata ${found.from}.${path.join('.')}`);
    return found?.value;
  };
  const abilityField = (ability: string, path: readonly string[]) => {
    const found = inheritedField(abilities, ability, path);
    if (found) evidence.push(`abilities.vdata ${found.from}.${path.join('.')}`);
    return found?.value;
  };

  const meleeAbility = heroField(['m_mapBoundAbilities', 'ESlot_Weapon_Melee']);
  let melee: MovementGameData['melee'] = null;
  if (typeof meleeAbility === 'string' && isTable(abilities[meleeAbility])) {
    const heavy = (field: string) => abilityField(meleeAbility, ['m_mapAttacks', 'EAttackType_Heavy', field]);
    const attachment = abilityField(meleeAbility, ['m_strEffectsAttachName']);
    melee = {
      ability: meleeAbility,
      attachment: typeof attachment === 'string' && attachment !== '' ? attachment : null,
      holdBegin: particle(abilityField(meleeAbility, ['m_HoldBeginEffect'])),
      attack: particle(heavy('m_MeleeAttackParticle')),
      swing: particle(heavy('m_MeleeSwingParticle')),
      impact: particle(heavy('m_MeleeImpactParticle')),
      lunge: speedCurveTravel(heavy('m_MovementSpeedCurve')),
    };
  }

  const dashAbility = heroField(['m_mapBoundAbilities', 'ESlot_Ability_Innate_1']);
  let dash: MovementGameData['dash'] = null;
  const distance = finite(heroField(['m_mapStartingStats', 'EAirDashDistanceInMeters']));
  const duration = finite(heroField(['m_mapStartingStats', 'EAirDashDuration']));
  if (typeof dashAbility === 'string' && isTable(abilities[dashAbility]) && distance !== null && duration !== null && duration > 0) {
    dash = { ability: dashAbility, particle: particle(abilityField(dashAbility, ['m_DashParticle'])), distance: distance * INCHES_PER_METER, duration };
  }

  return { heroKey, melee, dash, evidence };
}
