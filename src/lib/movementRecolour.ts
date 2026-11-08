// The live recolour of a movement effect (dash, heavy melee, parry): the edit vpkmerge's
// `workshop movement` bakes (vpkmerge-core/src/workshop.rs, `movement_fx`), applied to the game's own
// particle definitions in memory, so a preview shows a colour change without a bake. vpkmerge stays
// the source of truth for what is saved and exported; movementRecolour.live.test.ts bakes a set of
// choices with it and fails on any field this port gets different. Pure, no DOM, no Node: the main
// process plans the edit, the renderer applies it.

import type { KVObject, KVValue } from './particles/kv';
import type { MovementEnginePreview, MovementFxChoice, MovementPalette, ParryPart } from './movementFx';
import type { ParticleBundle } from './particles/host/bundle';

/** Where vpkmerge packs the stamp images (workshop.rs DASH_STAMP_PATH, PARRY_SHIELD_PATH, PARRY_STUN_PATH). */
export const DASH_STAMP_PATH = 'materials/grimoire/movement/dash_stamp.vtex';
export const PARRY_SHIELD_PATH = 'materials/grimoire/movement/parry_shield.vtex';
export const PARRY_STUN_PATH = 'materials/grimoire/movement/parry_stun.vtex';
/** The parry systems whose glyphs the stamps replace, and the glyphs (PARRY_SHIELD_SYSTEM, ...). */
export const PARRY_SHIELD_SYSTEM = 'particles/abilities/melee/melee_parry_symbol.vpcf_c';
export const PARRY_SHIELD_TEXTURE = 'materials/particle/glyphs/symbol_knot_shield.vtex';
export const PARRY_STUN_SYSTEM = 'particles/abilities/melee/melee_parry_debuff_symbol.vpcf_c';
export const PARRY_STUN_TEXTURE = 'dev/vgui/materials/hud/gameinstructor_iconsheet1.vtex';
/** The game texture a stamp takes its format, size and mips from (DASH_STAMP_TEMPLATE). */
export const STAMP_TEMPLATE = 'materials/particle/abilities/priest/priest_potent_vapors_cross.vtex';

export type MovementKind = MovementFxChoice['kind'];
/** A path into a decoded definition: object keys and array indices (morphic's `Seg`). */
export type KVPath = (string | number)[];
type RGB = [number, number, number];

/** How a system is coloured (PartPalette). */
export type RecolourPalette =
  | { mode: 'original' }
  | { mode: 'solid'; color: RGB }
  | { mode: 'gradient'; start: RGB; end: RGB }
  | { mode: 'rainbow' };

/** One system the bake rewrites: the parry part it belongs to and the colour arrays it scales. */
export interface RecolourSystem {
  part: ParryPart;
  /** The arrays collect_colors edits, found on the stored definition (integer channels only). */
  colors: KVPath[];
}

/** What a kind's bake rewrites, by compiled entry (`particles/...vpcf_c`). */
export interface RecolourPlan {
  kind: MovementKind;
  systems: Record<string, RecolourSystem>;
}

/** The part a parry system root belongs to; a child takes its parent's (ParryPart::of). */
export function parryPartOf(entry: string): ParryPart {
  const name = entry.startsWith('particles/abilities/melee/') ? entry.slice('particles/abilities/melee/'.length) : entry;
  if (name.startsWith('melee_parry_success')) return 'catch';
  if (name.startsWith('melee_parry_debuff')) return 'stun';
  return 'shield';
}

/** The roots a kind's bake starts from, out of the base package's entries (movement_roots). */
export function movementRoots(kind: MovementKind, entries: Iterable<string>): string[] {
  if (kind === 'dash') return ['air_dash', 'down_dash', 'roll_jump'].map((name) => `particles/generic/${name}.vpcf_c`);
  const all = [...entries];
  const roots = kind === 'parry'
    ? all.filter((path) => path.startsWith('particles/abilities/melee/melee_parry') && path.endsWith('.vpcf_c'))
    : all.filter((path) => (path.startsWith('particles/abilities/melee/') || path.startsWith('particles/abilities/melee_'))
      && path.endsWith('.vpcf_c') && (path.split('/').pop() ?? '').includes('heavy'));
  if (roots.length === 0) throw new Error('No matching movement effects in this game build');
  return roots;
}

/** `particles/x.vpcf` as the bake reads it (compiled). */
export const compiledEntry = (path: string) => `${path.replace(/\\/g, '/')}_c`;

/**
 * Walks a kind's systems as the bake does: each root and its children, a child taking the part of the
 * system it was first reached from, depth first from the last root. `decode` reads one stored
 * definition with integers as bigint (a KV3 int) and every other number a double.
 */
export async function planMovementRecolour(kind: MovementKind, entries: Iterable<string>,
  decode: (entry: string) => Promise<TypedKV>): Promise<RecolourPlan> {
  const queue: [string, ParryPart][] = movementRoots(kind, entries).map((entry) => [entry, parryPartOf(entry)]);
  const systems: Record<string, RecolourSystem> = {};
  const seen = new Set<string>();
  while (queue.length > 0) {
    const [entry, part] = queue.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (seen.size > 256) throw new Error('Movement particle graph exceeds 256 systems');
    if (!entry.startsWith('particles/') || entry.includes('..') || entry.includes('\\')) throw new Error('Invalid particle reference');
    const tree = await decode(entry);
    if (!isTypedObject(tree) || tree._class !== 'CParticleSystemDefinition') throw new Error(`Not a particle definition: ${entry}`);
    const children = tree.m_Children;
    for (const child of Array.isArray(children) ? children : []) {
      const ref = isTypedObject(child) ? child.m_ChildRef : undefined;
      if (typeof ref === 'string') queue.push([compiledEntry(ref), part]);
    }
    const colors: KVPath[] = [];
    collectColors(tree, [], false, colors);
    systems[entry] = { part, colors };
  }
  return { kind, systems };
}

/** A decoded definition keeping KV3's integer type: integers are bigint, doubles number. */
export type TypedKV = null | boolean | number | bigint | string | TypedKV[] | { [key: string]: TypedKV };
const isTypedObject = (value: TypedKV | undefined): value is { [key: string]: TypedKV } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** vpkmerge's JSON projection read with its integers as bigint (a `1.0` stays a double). */
export function parseTypedKV(text: string): TypedKV {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source !== undefined && /^-?\d+$/.test(context.source) ? BigInt(context.source) : value) as TypedKV;
}

/** The colour arrays the bake rescales: three or four integer channels in 0..=255 under a key naming a colour or tint (collect_colors). */
function collectColors(value: TypedKV, path: KVPath, colorish: boolean, out: KVPath[]): void {
  if (Array.isArray(value)) {
    if (colorish && (value.length === 3 || value.length === 4)
      && value.every((channel) => typeof channel === 'bigint' && channel >= 0n && channel <= 255n)) {
      out.push([...path]);
      return;
    }
    value.forEach((child, index) => collectColors(child, [...path, index], false, out));
  } else if (isTypedObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const name = key.toLowerCase();
      collectColors(child, [...path, key], name.includes('color') || name.includes('tint'), out);
    }
  }
}

const parseColor = (color: string): RGB => {
  const hex = color.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Expected a six-digit RGB color');
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as RGB;
};

const palette = (color: string, value: MovementPalette): RecolourPalette =>
  value.mode === 'rainbow' ? { mode: 'rainbow' }
    : value.mode === 'gradient' ? { mode: 'gradient', start: parseColor(color), end: parseColor(value.end) }
      : { mode: 'solid', color: parseColor(color) };

/** The palette a system of `part` takes: the effect's, or a parry part's own (movement_fx palette_of, parryPartArgs). */
export function paletteFor(choice: MovementFxChoice, part: ParryPart): RecolourPalette {
  const main = palette(choice.color, choice.palette);
  if (choice.kind !== 'parry' || !choice.parts) return main;
  const own = choice.parts[part];
  if (own.original) return { mode: 'original' };
  return choice.parts.linked ? main : palette(own.color, own.palette);
}

const clone = <T extends KVValue>(value: T): T => structuredClone(value);

function at(root: KVValue, path: KVPath): KVValue | undefined {
  let node: KVValue | undefined = root;
  for (const segment of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, KVValue>)[segment];
  }
  return node;
}

/** Every string in the tree equal (any case) to a key of `map` becomes its value, lower case; each key must be found (repoint_resource_refs). */
function repoint(tree: KVObject, map: [string, string][]): void {
  const strings: [KVValue[] | KVObject, string | number, string][] = [];
  const visit = (holder: KVValue[] | KVObject, key: string | number, value: KVValue) => {
    if (typeof value === 'string') strings.push([holder, key, value]);
    else if (Array.isArray(value)) value.forEach((item, index) => visit(value, index, item));
    else if (value !== null && typeof value === 'object') for (const [name, member] of Object.entries(value)) visit(value, name, member);
  };
  for (const [name, member] of Object.entries(tree)) visit(tree, name, member);
  for (const [from, to] of map) {
    const matches = strings.filter(([, , value]) => value.toLowerCase() === from.toLowerCase());
    if (matches.length === 0) throw new Error(`Missing reference ${from.toLowerCase()}`);
    for (const [holder, key] of matches) (holder as Record<string | number, KVValue>)[key] = to.toLowerCase();
  }
}

const renderersOf = (tree: KVObject): KVObject[] =>
  (Array.isArray(tree.m_Renderers) ? tree.m_Renderers : []).filter((value): value is KVObject => value !== null && typeof value === 'object' && !Array.isArray(value));
const texturesOf = (renderer: KVObject): KVObject[] =>
  (Array.isArray(renderer.m_vecTexturesInput) ? renderer.m_vecTexturesInput : []).filter((value): value is KVObject => value !== null && typeof value === 'object' && !Array.isArray(value));

/** The dash trail drawn as sprites of the stamp, alpha blended (image_trail). */
function imageTrail(tree: KVObject, imagePath: string): void {
  if (!Array.isArray(tree.m_Renderers)) throw new Error('Dash trail has no renderer');
  const references: [string, string][] = [];
  for (const renderer of renderersOf(tree)) {
    if (renderer._class !== 'C_OP_RenderRopes') throw new Error('Dash renderer changed; image stamps need a recipe update');
    if (!Array.isArray(renderer.m_vecTexturesInput)) throw new Error('Dash trail has no texture inputs');
    const textures = texturesOf(renderer);
    if (textures.length === 0) throw new Error('Dash trail has no primary texture');
    if (textures.some((texture, index) => index > 0 && texture.m_bEnabled !== false)) {
      throw new Error('Dash trail has another enabled layer; image stamps need a recipe update');
    }
    const original = textures[0].m_hTexture;
    if (typeof original !== 'string') throw new Error('Dash trail has no primary texture resource');
    references.push([original, imagePath]);
    renderer._class = 'C_OP_RenderSprites';
    if ('m_nOutputBlendMode' in renderer) renderer.m_nOutputBlendMode = 'PARTICLE_OUTPUT_BLEND_MODE_ALPHA';
  }
  repoint(tree, references);
}

/** The outline the bake turns on around a stamp (trail_appearance, parry_appearance). */
function setOutline(renderer: KVObject, color: string): void {
  Object.assign(renderer, {
    m_bOutline: true, m_OutlineColor: parseColor(color),
    m_flOutlineStart0: 0.1, m_flOutlineStart1: 0.25, m_flOutlineEnd0: 0.7, m_flOutlineEnd1: 0.9,
  });
}

const literal = (value: number): KVObject => ({ m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: value });

/** Brightness, illumination and the stamp's outline on a dash trail's renderers (trail_appearance). */
function trailAppearance(tree: KVObject, image: boolean, brightness: number, illuminated: boolean, outline: string | null): void {
  if (!image && brightness === 1 && !illuminated && !outline) return;
  if (!Array.isArray(tree.m_Renderers)) throw new Error('Trail has no renderers');
  for (const renderer of tree.m_Renderers) {
    if (renderer === null || typeof renderer !== 'object' || Array.isArray(renderer)) throw new Error('Trail renderer is not an object');
    const light = renderer.m_flSelfIllumAmount !== undefined ? clone(renderer.m_flSelfIllumAmount) : literal(1);
    if (light === null || typeof light !== 'object' || Array.isArray(light) || !('m_flLiteralValue' in light)) throw new Error('Trail illumination is not a literal');
    const value = light.m_flLiteralValue;
    if (!image && typeof value !== 'number') throw new Error('Trail illumination is not numeric');
    light.m_flLiteralValue = (image ? 1 : value as number) * brightness * (illuminated ? 3 : 1);
    renderer.m_flSelfIllumAmount = light;
    if (outline) setOutline(renderer, outline);
  }
}

/** Brightness and illumination on a parry system's sprites, ropes and trails; the outline on the shield stamp (parry_appearance). */
function parryAppearance(tree: KVObject, brightness: number, illuminated: boolean, outline: string | null): void {
  if (brightness === 1 && !illuminated && !outline) return;
  for (const renderer of renderersOf(tree)) {
    const kind = typeof renderer._class === 'string' ? renderer._class : '';
    if (!['C_OP_RenderSprites', 'C_OP_RenderRopes', 'C_OP_RenderTrails'].includes(kind)) continue;
    const stamped = texturesOf(renderer)[0]?.m_hTexture === PARRY_SHIELD_PATH;
    const light = renderer.m_flSelfIllumAmount !== undefined ? clone(renderer.m_flSelfIllumAmount) : literal(1);
    // A driven (non-literal) illumination stays as authored
    if (light !== null && typeof light === 'object' && !Array.isArray(light) && 'm_flLiteralValue' in light) {
      const base = typeof light.m_flLiteralValue === 'number' ? light.m_flLiteralValue : 1;
      light.m_flLiteralValue = base * brightness * (illuminated ? 3 : 1);
    }
    renderer.m_flSelfIllumAmount = light;
    if (outline && stamped && kind === 'C_OP_RenderSprites') setOutline(renderer, outline);
  }
}

/** The renderer layer drawing `original` pointed at a stamp (swap_texture). */
function swapTexture(tree: KVObject, original: string, stamp: string): void {
  const drawn = renderersOf(tree).some((renderer) => texturesOf(renderer).some((texture) => texture.m_hTexture === original));
  if (!drawn) throw new Error('Parry symbol changed; image stamps need a recipe update');
  repoint(tree, [[original, stamp]]);
}

/** The parry's stamps on one of its systems (parry_stamps). */
function parryStamps(tree: KVObject, entry: string, choice: MovementFxChoice): void {
  if (choice.image && entry === PARRY_SHIELD_SYSTEM) swapTexture(tree, PARRY_SHIELD_TEXTURE, PARRY_SHIELD_PATH);
  if (choice.stunImage && entry === PARRY_STUN_SYSTEM) swapTexture(tree, PARRY_STUN_TEXTURE, PARRY_STUN_PATH);
}

const RAINBOW: RGB[] = [[255, 50, 50], [255, 230, 50], [50, 255, 90], [50, 220, 255], [100, 70, 255], [255, 60, 200], [255, 50, 50]];

/** An RGB operator appended after the system's own: particle age ramps a gradient, collection age cycles a rainbow (color_ramp). */
function colorRamp(tree: KVObject, start: RGB, end: RGB | null, rainbow: boolean): void {
  if (!Array.isArray(tree.m_Operators)) return;
  const colors = rainbow ? RAINBOW : [start, end ?? start];
  const intervals = colors.length - 1;
  tree.m_Operators.push({
    _class: 'C_OP_SetVec',
    m_nOutputField: 6,
    m_InputValue: {
      m_nType: 'PVEC_TYPE_FLOAT_INTERP_GRADIENT',
      m_FloatInterp: {
        m_nType: rainbow ? 'PF_TYPE_COLLECTION_AGE' : 'PF_TYPE_PARTICLE_AGE_NORMALIZED',
        m_nInputMode: rainbow ? 'PF_INPUT_MODE_LOOPED' : 'PF_INPUT_MODE_CLAMPED',
        m_flInput0: 0, m_flInput1: rainbow ? 1.5 : 1, m_flOutput0: 0, m_flOutput1: 1,
      },
      m_Gradient: { m_Stops: colors.map((rgb, i) => ({ m_flPosition: i / intervals, m_Color: [...rgb] })) },
    },
  });
}

/**
 * One system of `plan` with the choice applied (movement_entry): a new definition, or the same object
 * when the bake would write it unchanged. `entry` is the compiled path.
 */
export function recolourSystem(definition: KVObject, entry: string, system: RecolourSystem, kind: MovementKind, choice: MovementFxChoice): KVObject {
  const brightness = kind === 'heavy-melee' ? 1 : choice.brightness;
  const illuminated = kind !== 'heavy-melee' && choice.illuminated;
  const outline = kind !== 'heavy-melee' && choice.outline && choice.image ? choice.outlineColor : null;
  const scheme = kind === 'parry' ? paletteFor(choice, system.part) : palette(choice.color, choice.palette);
  const tree = clone(definition);
  if (scheme.mode === 'original') {
    parryStamps(tree, entry, choice);
    return tree;
  }
  const fallback = parseColor(choice.color);
  const [rgb, end, rainbow]: [RGB, RGB | null, boolean] = scheme.mode === 'solid' ? [scheme.color, null, false]
    : scheme.mode === 'gradient' ? [scheme.start, scheme.end, false] : [fallback, null, true];
  const colored = kind !== 'dash' || entry.endsWith('_trail.vpcf_c') || rainbow;
  if (colored) {
    for (const path of system.colors) {
      const channels = at(tree, path);
      if (!Array.isArray(channels)) continue;
      const peak = Math.max(...channels.slice(0, 3).map(Number));
      // (channel * peak + 127) / 255 in integers
      rgb.forEach((channel, index) => { channels[index] = Math.floor((channel * peak + 127) / 255); });
    }
  }
  const image = !!choice.image;
  if (image && entry.startsWith('particles/generic/') && entry.endsWith('_trail.vpcf_c')) imageTrail(tree, DASH_STAMP_PATH);
  if (kind === 'dash' && entry.endsWith('_trail.vpcf_c')) trailAppearance(tree, image, brightness, illuminated, outline);
  if (kind === 'parry') {
    parryStamps(tree, entry, choice);
    parryAppearance(tree, brightness, illuminated, image && entry === PARRY_SHIELD_SYSTEM ? outline : null);
  }
  if (colored && (rainbow || end)) colorRamp(tree, rgb, end, rainbow);
  return tree;
}

/** The stamp images a choice packs, by texture path (the bake writes each at its path). */
export function movementStamps(choice: MovementFxChoice): Record<string, string> {
  const stamps: Record<string, string> = {};
  if (choice.image && choice.kind !== 'heavy-melee') stamps[choice.kind === 'parry' ? PARRY_SHIELD_PATH : DASH_STAMP_PATH] = choice.image;
  if (choice.stunImage && choice.kind === 'parry') stamps[PARRY_STUN_PATH] = choice.stunImage;
  return stamps;
}

/** A PNG data URL's size, from its header. */
function pngSize(dataUrl: string): { width: number; height: number } | null {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 44);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  if (bytes.length < 24) return null;
  const read = (offset: number) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  return { width: read(16), height: read(20) };
}

/**
 * The game's own engine bundle with `choice` applied as the bake would: the planned systems recoloured
 * (unchanged ones keep their objects, so a running effect can tell what changed) and each stamp image
 * served from its data URL with the header of the texture the bake builds it from.
 */
export function applyMovementRecolour(bundle: ParticleBundle, recolour: NonNullable<MovementEnginePreview['recolour']>, choice: MovementFxChoice): ParticleBundle {
  const systems = { ...bundle.systems };
  for (const [key, system] of Object.entries(recolour.systems)) {
    const stored = bundle.systems[key];
    if (stored) systems[key] = { ...stored, data: recolourSystem(stored.data, `${key}_c`, system, choice.kind, choice) };
  }
  const textures = { ...bundle.textures };
  for (const [path, url] of Object.entries(movementStamps(choice))) {
    const size = pngSize(url);
    // The bake stretches the image to the template's size; sampling the image as it is does the same
    const info = recolour.stamp ?? (size ? { width: size.width, height: size.height, format: 0, flags: 0, mipLevels: 1, motionVectorsMaxDistance: 0, sheet: null } : null);
    if (info) textures[path] = { file: '', url, info };
  }
  return { ...bundle, systems, textures };
}
