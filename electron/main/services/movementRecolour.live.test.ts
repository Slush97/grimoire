// Parity guard for the live movement recolour (src/lib/movementRecolour.ts): bakes representative
// choices with vpkmerge, the source of truth for Save and Export, and compares every system it writes
// with the game's definition edited in TypeScript. Any field that differs fails. Needs the game's
// pak01 and a vpkmerge with `workshop movement --part`; skipped without them.

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { movementBakeArgs, movementFxSchema, type MovementFxChoice, type ParryPartChoice } from '../../../src/lib/movementFx';
import { type MovementKind, type RecolourPlan, movementStamps, parseTypedKV, planMovementRecolour, recolourSystem } from '../../../src/lib/movementRecolour';
import type { KVObject, KVValue } from '../../../src/lib/particles/kv';
import { parseVpkDirectory } from './vpk';

const VPKMERGE = process.env.MOVEMENT_PARITY_VPKMERGE ?? 'C:\\Users\\USER\\loop\\vpkmerge-parry-bin\\vpkmerge.exe';
const PAK = process.env.DEADLOCK_PAK ?? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk';
const missing = [!existsSync(VPKMERGE) && `vpkmerge at ${VPKMERGE} (MOVEMENT_PARITY_VPKMERGE)`, !existsSync(PAK) && `the game's pak01 at ${PAK} (DEADLOCK_PAK)`].filter(Boolean);
const run = promisify(execFile);

if (missing.length > 0) console.warn(`[movementRecolour.live] skipped: no ${missing.join(' and no ')}`);

const vpkmerge = async (args: string[]) => (await run(VPKMERGE, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true })).stdout;

/** A small PNG whose halves differ, as a data URL. */
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.from([0, ...Array.from({ length: width }, (_, x) => pixel(x, y)).flat()])));
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}
const STAMP = png(16, 16, (x, y) => (y < 8 ? [255, 40, 40, 255] : x < 8 ? [40, 255, 40, 255] : [0, 0, 0, 0]));
const STUN = png(16, 16, (x) => (x < 8 ? [40, 40, 255, 255] : [255, 255, 255, 128]));

const choice = (value: Partial<MovementFxChoice> & { kind: MovementKind }): MovementFxChoice =>
  movementFxSchema.parse({ color: '#ff70cf', image: null, ...value });
const part = (color: string, extra: Partial<ParryPartChoice> = {}): ParryPartChoice => ({ original: false, color, palette: { mode: 'solid' }, ...extra });

const CASES: [string, MovementFxChoice][] = [
  ['dash solid', choice({ kind: 'dash', color: '#21c4ff' })],
  ['dash gradient', choice({ kind: 'dash', palette: { mode: 'gradient', end: '#ffd000' } })],
  ['dash rainbow', choice({ kind: 'dash', palette: { mode: 'rainbow' } })],
  ['dash brightness, illuminated', choice({ kind: 'dash', color: '#80ff40', brightness: 2.5, illuminated: true })],
  ['dash image with outline', choice({ kind: 'dash', image: STAMP, outline: true, outlineColor: '#00ffaa', brightness: 0.5 })],
  ['heavy melee solid', choice({ kind: 'heavy-melee', color: '#ffaa00' })],
  ['heavy melee gradient', choice({ kind: 'heavy-melee', palette: { mode: 'gradient', end: '#2040ff' } })],
  ['heavy melee rainbow', choice({ kind: 'heavy-melee', palette: { mode: 'rainbow' } })],
  ['parry solid, brightness', choice({ kind: 'parry', color: '#40ff90', brightness: 1.75 })],
  ['parry rainbow, illuminated', choice({ kind: 'parry', palette: { mode: 'rainbow' }, illuminated: true })],
  ['parry images with outline', choice({ kind: 'parry', image: STAMP, stunImage: STUN, outline: true, outlineColor: '#ff0000' })],
  ['parry parts linked, catch original', choice({ kind: 'parry', color: '#ffee00',
    parts: { linked: true, shield: part('#ffee00'), catch: part('#ffee00', { original: true }), stun: part('#ffee00') } })],
  ['parry parts unlinked', choice({ kind: 'parry', color: '#ffee00', palette: { mode: 'gradient', end: '#ff0000' },
    parts: { linked: false, shield: part('#00ffff'), catch: part('#ff00ff', { palette: { mode: 'gradient', end: '#00ff00' } }), stun: part('#ffffff', { palette: { mode: 'rainbow' } }) } })],
  ['parry shield original, images', choice({ kind: 'parry', image: STAMP, stunImage: STUN, illuminated: true,
    parts: { linked: false, shield: part('#00ffff', { original: true }), catch: part('#ff8000'), stun: part('#8000ff') } })],
];

/** Runs `work` on each item, eight at a time. */
async function each<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]); }
  }));
  return results;
}

/** The first difference between two decoded trees, as a path, or null. Objects compare by keys, not order. */
function difference(actual: KVValue | undefined, expected: KVValue | undefined, path = ''): string | null {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`;
    if (actual.length !== expected.length) return `${path}: ${actual.length} items != ${expected.length}`;
    for (let i = 0; i < actual.length; i++) { const found = difference(actual[i], expected[i], `${path}[${i}]`); if (found) return found; }
    return null;
  }
  if (expected !== null && typeof expected === 'object' && actual !== null && typeof actual === 'object') {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const found = difference((actual as KVObject)[key], (expected as KVObject)[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`;
}

describe.skipIf(missing.length > 0)(`movement recolour matches vpkmerge's bake${missing.length > 0 ? ` (skipped: no ${missing.join(', no ')})` : ''}`, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'movement-parity-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const entries = existsSync(PAK) ? parseVpkDirectory(PAK) ?? [] : [];
  const vanilla = new Map<string, Promise<string>>();
  const vanillaText = (entry: string) => {
    if (!vanilla.has(entry)) vanilla.set(entry, vpkmerge(['soundevents', entry, '--from-vpk', PAK]));
    return vanilla.get(entry)!;
  };
  const plans = new Map<MovementKind, Promise<RecolourPlan>>();
  const planFor = (kind: MovementKind) => {
    if (!plans.has(kind)) plans.set(kind, planMovementRecolour(kind, entries, async (entry) => parseTypedKV(await vanillaText(entry))));
    return plans.get(kind)!;
  };

  it.each(CASES)('%s', async (name, value) => {
    const plan = await planFor(value.kind);
    const dir = join(scratch, name.replace(/[^a-z0-9]+/gi, '_'));
    const stamps: { image?: string; stunImage?: string } = {};
    for (const [key, url] of [['image', value.image], ['stunImage', value.stunImage]] as const) {
      if (!url) continue;
      stamps[key] = join(scratch, `${name.replace(/[^a-z0-9]+/gi, '_')}_${key}.png`);
      writeFileSync(stamps[key]!, Buffer.from(url.split(',')[1], 'base64'));
    }
    const out = join(dir, 'effect_dir.vpk');
    await vpkmerge(['workshop', 'movement', '--vpk', PAK, ...movementBakeArgs(value, stamps), '--encode-vpk', out]);
    const baked = parseVpkDirectory(out) ?? [];
    // The stamps are packed at their paths, and nothing else but definitions
    expect(baked.filter((entry) => !entry.endsWith('.vpcf_c')).sort()).toEqual(Object.keys(movementStamps(value)).map((path) => `${path}_c`).sort());
    const systems = baked.filter((entry) => entry.endsWith('.vpcf_c'));
    expect(systems.filter((entry) => !(entry in plan.systems))).toEqual([]);
    const failures = (await each(Object.keys(plan.systems), async (entry) => {
      const original = JSON.parse(await vanillaText(entry)) as KVObject;
      const expected = recolourSystem(original, entry, plan.systems[entry], value.kind, value);
      // An entry the bake leaves out is the game's own
      const actual = systems.includes(entry) ? JSON.parse(await vpkmerge(['soundevents', entry, '--from-vpk', out])) as KVObject : original;
      const found = difference(actual, expected);
      if (found) return `${entry}${found}`;
      return difference(original, expected) ? 'changed' : null;
    }));
    expect(failures.filter((failure) => failure && failure !== 'changed')).toEqual([]);
    // The choice changed something, in TypeScript as in the bake
    expect(failures.filter((failure) => failure === 'changed').length).toBeGreaterThan(0);
  }, 300_000);
});
