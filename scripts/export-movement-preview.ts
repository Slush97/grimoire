// Exports what the Foundry movement preview shows for a baked movement effect, without Electron, for the
// dev hero viewer (hero-preview.html?movement=...): the old path's bound descriptor and the engine
// path's bundle and game data (the same code as electron/main/services/movementFx.ts), and a copy of
// each hero's rigged model from the app's pose cache with its movement clips exported again by the
// current clip selection (src/lib/movementMotion.ts).
//
// usage: pnpm exec tsx scripts/export-movement-preview.ts <bake dir> <Hero>... [--out .codex-run/movement-preview]
//        [--cache <app hero-poses dir>] [--deadlock <Deadlock install>] [--vanilla]
//
// --vanilla exports the engine path from the game's own effects, without the bake's package (under a
// key derived from the bake's), to compare with the game; the old path keeps the bake's descriptor.
//
// <bake dir> is a movement effect bake of the app (userData/movement-fx/<key>/: effect_dir.vpk,
// effect.json, effect-tex/). Writes <out>/bakes/<key>/ (effect.json per hero, effect-tex/, engine/) and
// <out>/cache/<hero>_vanilla/; serve them with scripts/hero-preview-server.mjs --cache <out>/cache
// --movement <out>/bakes.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { codenamesForHero } from '../electron/main/services/heroCodenames';
import { exportParticleBundle } from '../electron/main/services/heroParticleBundle';
import { PackageStack } from '../electron/main/services/heroParticleSources';
import { parseVpkDirectory } from '../electron/main/services/vpk';
import type { FxDescriptor } from '../src/components/locker/fxDescriptor';
import { bindMeleeAttachment, resolveMeleeAttachment } from '../src/lib/movementAttachment';
import { resolveMovementGameData } from '../src/lib/movementGameData';
import { selectMovementClips } from '../src/lib/movementMotion';
import { getString, isCollection, type KVObject } from '../src/lib/particles/kv';
import { DEFAULT_DEADLOCK, nodeVpkmerge, nodeVpkmergePath } from './lib/nodeVpkmerge';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const run = promisify(execFile);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let out = join(root, '.codex-run/movement-preview');
  let cache = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'grimoire', 'hero-poses');
  let deadlock = DEFAULT_DEADLOCK;
  let vanilla = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = () => args[++i] ?? '';
    switch (args[i]) {
      case '--out': out = resolve(value()); break;
      case '--cache': cache = resolve(value()); break;
      case '--deadlock': deadlock = value(); break;
      case '--vanilla': vanilla = true; break;
      default: positional.push(args[i]);
    }
  }
  const [bake, ...heroes] = positional;
  if (!bake || heroes.length === 0) throw new Error('usage: export-movement-preview.ts <bake dir> <Hero>...');

  const key = vanilla ? createHash('sha256').update(`vanilla:${basename(resolve(bake))}`).digest('hex') : basename(resolve(bake));
  const pak = join(deadlock, 'game/citadel/pak01_dir.vpk');
  const packages = [...(vanilla ? [] : [join(bake, 'effect_dir.vpk')]), pak, join(deadlock, 'game/core/pak01_dir.vpk')];
  if (vanilla) console.log(`vanilla key ${key}`);
  const vpkmerge = nodeVpkmerge();
  const bakeOut = join(out, 'bakes', key);
  await fs.mkdir(bakeOut, { recursive: true });
  await fs.cp(join(bake, 'effect-tex'), join(bakeOut, 'effect-tex'), { recursive: true });
  const descriptor = JSON.parse(await fs.readFile(join(bake, 'effect.json'), 'utf8')) as FxDescriptor & { name?: string };
  const kind = descriptor.name?.includes('air_dash') ? 'dash' : 'heavy-melee';

  const stack = new PackageStack(packages, vpkmerge, join(bakeOut, '.scratch'));
  const [heroData, abilities] = await Promise.all([stack.decode('scripts/heroes.vdata_c'), stack.decode('scripts/abilities.vdata_c')]);
  const directory = parseVpkDirectory(pak) ?? [];

  for (const hero of heroes) {
    const heroDir = hero.replace(/[^A-Za-z0-9]+/g, '_');
    const started = Date.now();
    const data = resolveMovementGameData(heroData, abilities, codenamesForHero(hero));
    if (!data) throw new Error(`No heroes.vdata entry for ${hero}.`);
    const entry = isCollection(heroData?.[data.heroKey] ?? null) ? heroData![data.heroKey] as KVObject : {};
    const modelEntry = `${(getString(entry, 'm_strModelName') ?? '').replace(/\\/g, '/')}_c`;

    // The old path: the bake's descriptor bound to the melee attachment, as previewMovementFx binds it
    const attachment = kind === 'heavy-melee' ? resolveMeleeAttachment(heroData, abilities, codenamesForHero(hero)) : undefined;
    await fs.writeFile(join(bakeOut, `effect.${heroDir}.json`), JSON.stringify(attachment ? bindMeleeAttachment(descriptor, attachment) : descriptor));

    // The engine path: as previewMovementEngine exports it
    const engineDir = join(bakeOut, 'engine', heroDir);
    await fs.mkdir(engineDir, { recursive: true });
    const systems = kind === 'dash' ? [data.dash?.particle] : [data.melee?.holdBegin, data.melee?.attack, data.melee?.swing, data.melee?.impact];
    const effects = systems.filter((system): system is string => !!system).map((system, i) => ({
      id: `${i}`, system, source: 'anim-event' as const, evidence: 'movement staging', configuration: 'preview', attachment: null, attachmentCp1: null,
    }));
    const bundle = await exportParticleBundle(stack, { heroKey: data.heroKey, modelEntry, effects, notes: [] }, { hero, outDir: engineDir, vpkmerge });
    await fs.writeFile(join(engineDir, 'preview.json'), JSON.stringify({
      key: `${key}:${heroDir}`, data,
      bundleUrl: `grimoire-hero://f/${key}/engine/${heroDir}/bundle.json`, textureBaseUrl: `grimoire-hero://f/${key}/engine/${heroDir}/tex/`,
    }));

    // The rigged model, with the movement clips of the current selection
    const caseDir = join(out, 'cache', `${hero.toLowerCase().replace(/[^a-zA-Z0-9_-]+/g, '_')}_vanilla`);
    const appCase = join(cache, basename(caseDir));
    await fs.mkdir(caseDir, { recursive: true });
    for (const file of ['model-rigged.glb', 'cloth-rigged.json', 'attachments.json']) {
      await fs.copyFile(join(appCase, file), join(caseDir, file)).catch(() => console.warn(`  no ${file} in ${appCase}`));
    }
    const motions = selectMovementClips(directory, modelEntry, codenamesForHero(hero));
    await run(nodeVpkmergePath(), ['workshop', 'motions', '--vpk', pak, '--entry', modelEntry,
      ...motions.flatMap(([name, path]) => ['--clip', `movement_${name}=${path}`]), '--out', join(caseDir, 'movement.glb')], { maxBuffer: 1 << 26 });

    console.log(`${hero} (${kind}): ${bundle.effects.length} effects, ${Object.keys(bundle.systems).length} systems, ${Object.keys(bundle.models ?? {}).length} models, `
      + `clips ${motions.map(([name]) => name).join(',')}, attachment ${data.melee?.attachment ?? '-'}, ${Date.now() - started} ms`);
    for (const diagnostic of bundle.diagnostics.filter((d) => d.kind !== 'mips-unavailable' && d.kind !== 'format-unknown')) console.log(`  ! ${diagnostic.kind}: ${diagnostic.message}`);
  }
  await fs.rm(join(bakeOut, '.scratch'), { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
