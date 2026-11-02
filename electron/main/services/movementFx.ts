import { nativeImage } from 'electron';
import { promises as fs, constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { movementFxSchema, movementFxPreviewSchema, movementFxSaveSchema, type MovementFxChoice, type MovementFxPreview } from '../../../src/lib/movementFx';
import { bindMeleeAttachment, resolveMeleeAttachment } from '../../../src/lib/movementAttachment';
import { codenamesForHero } from './heroCodenames';
import { getCitadelPath, metaKeyFor } from './deadlock';
import { exportParticleBundle } from './heroParticleExport';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput, vpkmergeBinaryPath } from './modMerger';
import { exportVpkViaDialog, exportVpkFileName } from './foundryExport';
import { allocateEnabledVpkPath, deleteModsUnlocked, reorderModsUnlocked, runExclusiveModMutation, scanMods } from './mods';
import { getModMetadata, removeModMetadata, setModMetadataWithHash } from './metadata';
import { assertVpkSafety } from './modSafety';
import { assertCanMoveLoadedGameMods, syncRunningGameModSnapshotFromMods } from './gameSessionMods';
import { notifyModChanges } from './modChangeObservation';
import type { FxDescriptor } from '../../../src/components/locker/fxDescriptor';
import { movementEngineHeroDir, movementFxCacheRoot as root } from './movementFxPaths';
import { resolveMovementGameData } from '../../../src/lib/movementGameData';
import type { MovementEnginePreview } from '../../../src/lib/movementFx';
import { PackageStack } from './heroParticleSources';
import { exportParticleBundle as exportSourceParticleBundle } from './heroParticleBundle';
import { MODEL_ENTRY_OVERRIDES } from './heroPoseModels';
import { getString, isCollection, type KVObject } from '../../../src/lib/particles/kv';
import { PARTICLE_BUNDLE_VERSION } from '../../../src/lib/particles/host/bundle';

const VERSION = 'movement-v5';
const inFlight = new Map<string, Promise<string>>();
const leases = new Map<string, number>();
const basePak = (game: string) => join(getCitadelPath(game), 'pak01_dir.vpk');
const fingerprint = async (path: string) => { const s = await fs.stat(path); return [path, s.size, s.mtimeMs]; };

/** Twelve recent variants or 128 MiB. In-flight builds and active readers hold leases. */
let sweeping: Promise<void> | undefined;
let sweepRequested = false;
function sweep(): Promise<void> {
  sweepRequested = true;
  sweeping ??= (async () => {
    while (sweepRequested) { sweepRequested = false; await sweepCache(); }
  })().finally(() => { sweeping = undefined; });
  return sweeping;
}
async function sweepCache(): Promise<void> {
  const entries = await fs.readdir(root(), { withFileTypes: true });
  for (const entry of entries.filter((e) => e.isDirectory() && e.name.startsWith('.build-'))) {
    const dir = join(root(), entry.name);
    if (Date.now() - (await fs.stat(dir)).mtimeMs > 30 * 60 * 1000) await fs.rm(dir, { recursive: true, force: true });
  }
  const candidates = await Promise.all(entries.filter((e) => e.isDirectory() && /^[a-f0-9]{64}$/.test(e.name)).map(async (e) => {
    const dir = join(root(), e.name);
    const files = await fs.readdir(dir, { recursive: true });
    const stats = await Promise.all(files.map((file) => fs.stat(join(dir, file))));
    return { key: e.name, dir, bytes: stats.reduce((sum, s) => sum + (s.isFile() ? s.size : 0), 0), used: (await fs.stat(join(dir, 'ready'))).mtimeMs };
  }));
  candidates.sort((a, b) => b.used - a.used);
  let bytes = 0;
  for (const [index, entry] of candidates.entries()) {
    bytes += entry.bytes;
    if ((index >= 12 || bytes > 128 * 1024 * 1024) && !leases.has(entry.key) && !inFlight.has(entry.key)) {
      await fs.rm(entry.dir, { recursive: true, force: true });
      bytes -= entry.bytes;
    }
  }
}

async function ensure(game: string, choice: MovementFxChoice, key: string): Promise<string> {
  const base = basePak(game);
  const dir = join(root(), key);
  if (!inFlight.has(key)) {
    const build = (async () => {
      try { await fs.access(join(dir, 'ready')); return dir; } catch { /* Build only complete cache entries. */ }
      await fs.mkdir(root(), { recursive: true });
      const temp = await fs.mkdtemp(join(root(), '.build-'));
      try {
        const args = ['workshop', 'movement', '--vpk', base, '--kind', choice.kind, '--color', choice.color, '--encode-vpk', join(temp, 'effect_dir.vpk')];
        if (choice.palette.mode === 'gradient') args.push('--end-color', choice.palette.end);
        if (choice.palette.mode === 'rainbow') args.push('--rainbow');
        if (choice.kind === 'dash') {
          args.push('--brightness', String(choice.brightness));
          if (choice.illuminated) args.push('--illuminated');
          if (choice.outline && choice.image) args.push('--outline-color', choice.outlineColor);
        }
        if (choice.image) {
          const image = nativeImage.createFromDataURL(choice.image);
          const { width, height } = image.getSize();
          if (image.isEmpty() || width > 512 || height > 512) throw new Error('Choose a PNG image up to 512 pixels.');
          const file = join(temp, 'stamp.png');
          await fs.writeFile(file, image.toPNG());
          args.push('--image', file);
        }
        await runVpkmerge(args);
        await verifyVpkOutput(join(temp, 'effect_dir.vpk'));
        await fs.writeFile(join(temp, 'ready'), VERSION);
        await fs.rm(dir, { recursive: true, force: true });
        await fs.rename(temp, dir);
        return dir;
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
    })();
    inFlight.set(key, build);
  }
  try { await inFlight.get(key); } finally { inFlight.delete(key); }
  const now = new Date();
  await fs.utimes(join(dir, 'ready'), now, now);
  return dir;
}

async function withBake<T>(game: string, input: unknown, work: (dir: string, choice: MovementFxChoice, key: string) => Promise<T>): Promise<T> {
  const choice = movementFxSchema.parse(input);
  const key = createHash('sha256').update(JSON.stringify([VERSION, await fingerprint(basePak(game)), await fingerprint(vpkmergeBinaryPath()), choice])).digest('hex');
  // Finish an eviction already in progress before checking this entry's ready marker.
  await sweeping?.catch(() => {});
  leases.set(key, (leases.get(key) ?? 0) + 1);
  try { return await work(await ensure(game, choice, key), choice, key); }
  finally {
    const count = (leases.get(key) ?? 1) - 1;
    if (count) leases.set(key, count); else leases.delete(key);
    void sweep().catch((error: unknown) => console.warn('[movementFx] Cache sweep:', error));
  }
}

const previewBuilds = new Map<string, Promise<void>>();
let bindings: { fingerprint: string; data: Promise<[unknown, unknown]> } | undefined;
async function meleeAttachment(game: string, heroName: string): Promise<string | undefined> {
  const pak = basePak(game), identity = JSON.stringify(await fingerprint(pak));
  if (bindings?.fingerprint !== identity) {
    const data = Promise.all(['scripts/heroes.vdata_c', 'scripts/abilities.vdata_c'].map(async entry => {
      const raw: unknown = JSON.parse(await runVpkmergeStdout(['soundevents', entry, '--from-vpk', pak]));
      return raw;
    })).then(([heroes, abilities]): [unknown, unknown] => [heroes, abilities]);
    bindings = { fingerprint: identity, data };
    void data.catch(() => { if (bindings?.data === data) bindings = undefined; });
  }
  const [heroes, abilities] = await bindings.data;
  return resolveMeleeAttachment(heroes, abilities, codenamesForHero(heroName));
}
export async function previewMovementFx(game: string, input: unknown): Promise<MovementFxPreview> {
  const request = movementFxPreviewSchema.parse(input);
  const attachment = request.choice.kind === 'heavy-melee' ? await meleeAttachment(game, request.heroName) : undefined;
  return withBake(game, request.choice, async (dir, choice, key) => {
    const file = join(dir, 'effect.json');
    if (!previewBuilds.has(key)) {
      const build = (async () => {
        try { await fs.access(file); return; } catch { /* Generate the bounded authored graph on demand. */ }
        const entry = choice.kind === 'dash' ? 'particles/generic/air_dash.vpcf_c' : 'particles/abilities/melee/melee_heavy_activate_charge.vpcf_c';
        const pending = join(dir, 'effect.pending.json');
        try {
          await exportParticleBundle(join(dir, 'effect_dir.vpk'), entry, pending, join(dir, 'effect-tex'), undefined,
            [join(dir, 'effect_dir.vpk'), basePak(game), join(game, 'game', 'core', 'pak01_dir.vpk')], 'preview');
          await fs.rename(pending, file);
        } finally { await fs.rm(pending, { force: true }); }
      })();
      previewBuilds.set(key, build);
    }
    try { await previewBuilds.get(key); } finally { previewBuilds.delete(key); }
    const descriptor = JSON.parse(await fs.readFile(file, 'utf8')) as FxDescriptor;
    return { key: `${key}:${request.heroName}`, descriptor: attachment ? bindMeleeAttachment(descriptor, attachment) : descriptor,
      textureBaseUrl: `grimoire-hero://f/${key}/effect-tex/` };
  });
}

const engineBuilds = new Map<string, Promise<MovementEnginePreview>>();
const ENGINE_VERSION = `engine-${PARTICLE_BUNDLE_VERSION}`;

/**
 * The faithful runtime's preview of a movement effect on a hero: the game data that stages it (the
 * hero's melee or dash ability, read through the package stack, the baked effect first) and a particle
 * bundle of every effect it names on the hero's model, under the bake's cache entry.
 */
export async function previewMovementEngine(game: string, input: unknown): Promise<MovementEnginePreview> {
  const request = movementFxPreviewSchema.parse(input);
  return withBake(game, request.choice, async (dir, choice, key) => {
    const heroDir = movementEngineHeroDir(request.heroName);
    const outDir = join(dir, 'engine', heroDir);
    const id = `${key}:${heroDir}`;
    if (!engineBuilds.has(id)) {
      const build = (async (): Promise<MovementEnginePreview> => {
        const cached = await fs.readFile(join(outDir, 'preview.json'), 'utf8').then((text) => JSON.parse(text) as MovementEnginePreview & { version?: string }, () => null);
        if (cached?.version === ENGINE_VERSION) return cached;
        await fs.rm(outDir, { recursive: true, force: true });
        await fs.mkdir(outDir, { recursive: true });
        const vpkmerge = { stdout: (args: string[]) => runVpkmergeStdout(args) };
        const stack = new PackageStack([join(dir, 'effect_dir.vpk'), basePak(game), join(game, 'game', 'core', 'pak01_dir.vpk')], vpkmerge, join(outDir, '.scratch'));
        try {
          const [heroes, abilities] = await Promise.all([stack.decode('scripts/heroes.vdata_c'), stack.decode('scripts/abilities.vdata_c')]);
          const data = resolveMovementGameData(heroes, abilities, codenamesForHero(request.heroName));
          if (!data) throw new Error(`No heroes.vdata entry for ${request.heroName}.`);
          const systems = choice.kind === 'dash'
            ? [data.dash?.particle]
            : [data.melee?.holdBegin, data.melee?.attack, data.melee?.swing, data.melee?.impact];
          const hero = isCollection(heroes?.[data.heroKey] ?? null) ? heroes![data.heroKey] as KVObject : {};
          const vdataModel = getString(hero, 'm_strModelName');
          const modelEntry = MODEL_ENTRY_OVERRIDES[request.heroName] ?? (vdataModel ? `${vdataModel.replace(/\\/g, '/')}_c` : '');
          if (!/^models\/[a-zA-Z0-9_./-]+\.vmdl_c$/.test(modelEntry)) throw new Error(`No model for ${request.heroName}.`);
          const effects = systems.filter((system): system is string => !!system).map((system, i) => ({
            id: `${i}`, system, source: 'anim-event' as const, evidence: 'movement staging', configuration: 'preview', attachment: null, attachmentCp1: null,
          }));
          await exportSourceParticleBundle(stack, { heroKey: data.heroKey, modelEntry, effects, notes: [] }, { hero: request.heroName, outDir, vpkmerge });
          const preview: MovementEnginePreview & { version: string } = {
            version: ENGINE_VERSION, key: `${key}:${heroDir}`, data,
            bundleUrl: `grimoire-hero://f/${key}/engine/${heroDir}/bundle.json`, textureBaseUrl: `grimoire-hero://f/${key}/engine/${heroDir}/tex/`,
          };
          await fs.writeFile(join(outDir, 'preview.json'), JSON.stringify(preview));
          return preview;
        } finally {
          await fs.rm(join(outDir, '.scratch'), { recursive: true, force: true });
        }
      })();
      engineBuilds.set(id, build);
    }
    try { return await engineBuilds.get(id)!; } finally { engineBuilds.delete(id); }
  });
}

export async function exportMovementFx(game: string, input: unknown) {
  return withBake(game, input, (dir, choice) => exportVpkViaDialog(join(dir, 'effect_dir.vpk'), exportVpkFileName(`custom_${choice.kind}`)));
}

export async function saveMovementFx(game: string, input: unknown): Promise<void> {
  const request = movementFxSaveSchema.parse(input);
  await withBake(game, request.choice, async (dir, choice) => {
    const source = join(dir, 'effect_dir.vpk');
    const name = choice.kind === 'dash' ? 'Custom dash trails' : 'Custom heavy melee';
    await assertVpkSafety(source, { context: 'installation', name });
    await runExclusiveModMutation(async () => {
      const before = await scanMods(game);
      await syncRunningGameModSnapshotFromMods(before);
      const replaced = before.filter((mod) => getModMetadata(mod.metaKey)?.movementFx?.kind === choice.kind);
      assertCanMoveLoadedGameMods(replaced);
      const destination = await allocateEnabledVpkPath(game);
      const key = metaKeyFor(destination);
      await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
      try {
        removeModMetadata(key);
        await setModMetadataWithHash(key, { modName: name, sourceSection: 'MovementFx', categoryName: 'Gameplay Effects', movementFx: choice, thumbnailUrl: request.thumbnailDataUrl }, destination);
        const enabled = (await scanMods(game)).filter((mod) => mod.enabled && !mod.priorityMod);
        const fresh = enabled.find((mod) => mod.metaKey === key);
        if (!fresh) throw new Error('The saved effect could not be found.');
        const old = new Set(replaced.map((mod) => mod.id));
        await reorderModsUnlocked(game, [fresh.id, ...enabled.filter((mod) => mod.id !== fresh.id && !old.has(mod.id)).map((mod) => mod.id)]);
      } catch (error) {
        await fs.unlink(destination).catch(() => {});
        removeModMetadata(key);
        throw error;
      }
      if (replaced.length) await deleteModsUnlocked(game, replaced.map(({ id, size, installedAt }) => ({ id, size, installedAt })));
    }, { healPath: game });
    notifyModChanges();
  });
}
