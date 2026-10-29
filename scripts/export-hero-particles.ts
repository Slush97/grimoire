// Exports a hero's particle bundle into a folder without Electron, through the same discovery and
// export code the app runs (electron/main/services/heroAmbientDiscovery.ts and heroParticleBundle.ts).
// The dev hero-preview harness (hero-preview.html) loads the result.
//
// usage: pnpm exec tsx scripts/export-hero-particles.ts <Hero name>... [--out .codex-run/hero-particles]
//        [--deadlock <Deadlock install>] [--skin <mod vpk>]... [--clips name,name] [--vpkmerge path]
//        [--format-vpkmerge path] [--mips-vpkmerge path]
//
// --skin mounts a mod VPK above the game's packages, highest priority first. --clips names clips the
// viewer plays, for their animation events. --format-vpkmerge sends only the stored format queries
// (soundevents --with-format) to another vpkmerge build, to try that flag before a release has it;
// --mips-vpkmerge sends the texture dumps (panorama dump --mips, every stored mip) the same way.

import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAmbientEffects } from '../electron/main/services/heroAmbientDiscovery';
import { exportParticleBundle } from '../electron/main/services/heroParticleBundle';
import { PackageStack } from '../electron/main/services/heroParticleSources';
import { DEFAULT_DEADLOCK, nodeVpkmerge, nodeVpkmergePath, withFormatVpkmerge, withMipsVpkmerge } from './lib/nodeVpkmerge';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const heroes: string[] = [];
  const skins: string[] = [];
  let out = join(root, '.codex-run/hero-particles');
  let deadlock = DEFAULT_DEADLOCK;
  let clips: string[] = [];
  let binary = nodeVpkmergePath();
  let formatBinary: string | null = null;
  let mipsBinary: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const value = () => args[++i] ?? '';
    switch (args[i]) {
      case '--out': out = resolve(value()); break;
      case '--deadlock': deadlock = value(); break;
      case '--skin': skins.push(resolve(value())); break;
      case '--clips': clips = value().split(',').filter(Boolean); break;
      case '--vpkmerge': binary = resolve(value()); break;
      case '--format-vpkmerge': formatBinary = resolve(value()); break;
      case '--mips-vpkmerge': mipsBinary = resolve(value()); break;
      default: heroes.push(args[i]);
    }
  }

  if (heroes.length === 0) {
    throw new Error('usage: export-hero-particles.ts <Hero name>... [--out dir] [--skin vpk]... [--clips a,b]');
  }

  let vpkmerge = nodeVpkmerge(binary);
  if (formatBinary !== null) vpkmerge = withFormatVpkmerge(vpkmerge, formatBinary);
  if (mipsBinary !== null) vpkmerge = withMipsVpkmerge(vpkmerge, mipsBinary);
  const packages = [...skins, join(deadlock, 'game/citadel/pak01_dir.vpk'), join(deadlock, 'game/core/pak01_dir.vpk')];

  for (const hero of heroes) {
    const outDir = join(out, hero.replace(/[^a-zA-Z0-9_-]+/g, '_'));
    await fs.mkdir(outDir, { recursive: true });
    const stack = new PackageStack(packages, vpkmerge, join(outDir, '.scratch'));
    const started = Date.now();
    const discovery = await discoverAmbientEffects(stack, hero, { clips });
    const bundle = await exportParticleBundle(stack, discovery, { hero, outDir, vpkmerge });
    await fs.rm(join(outDir, '.scratch'), { recursive: true, force: true });
    console.log(`${hero}: ${bundle.effects.length} effects, ${Object.keys(bundle.systems).length} systems, ${Object.keys(bundle.textures).length} textures, ` +
      `${Object.keys(bundle.snapshots).length} snapshots, ${bundle.model.bones.length} bones, ${bundle.attachments.length} attachments in ${Date.now() - started} ms -> ${outDir}`);
    for (const effect of bundle.effects) {
      console.log(`  ${effect.source}${effect.configuration ? ` [${effect.configuration}]` : ''} ${effect.system}  (${effect.evidence})`);
    }
    for (const diagnostic of bundle.diagnostics) {
      console.log(`  ! ${diagnostic.kind}: ${diagnostic.message}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
