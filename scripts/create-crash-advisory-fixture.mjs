// Builds an intentionally incompatible HUD addon outside the game installation.
// Install it manually for a crash-detection test, then disable or delete it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VPKMERGE_BINARY_BY_PLATFORM } from '../electron/main/services/vpkmergeBinary.ts';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--game') || !args.includes('--out')) throw new Error('Usage: node --experimental-strip-types scripts/create-crash-advisory-fixture.mjs --game DEADLOCK_DIR --out OUTPUT_DIR');
const game = resolve(option('--game'));
const output = resolve(option('--out'));
const outputRelativeToGame = relative(game, output);
if (!outputRelativeToGame || outputRelativeToGame !== '..' && !outputRelativeToGame.startsWith('..' + sep) && !isAbsolute(outputRelativeToGame)) throw new Error('Output must be outside the game installation');
const repo = fileURLToPath(new URL('../', import.meta.url));
const asset = VPKMERGE_BINARY_BY_PLATFORM[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('Unsupported build platform');
const cli = join(repo, 'resources/vpkmerge', asset);
const workspace = join(output, 'fixture-workspace');
mkdirSync(output, { recursive: true });
const run = args => {
  const result = spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
};
run(['panorama', 'dump', '--vpk', join(game, 'game/citadel/pak01_dir.vpk'), '--out-dir', workspace,
  '--prefix', 'panorama/layout/citadel_hero_abilities.vxml_c']);
const manifestPath = join(workspace, '_manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = manifest.entries.filter(entry => entry.mode !== 'skipped');
if (entries.length !== 1 || entries[0].mode !== 'layout-xml') throw new Error('Expected one reconstructable layout template');
const entry = entries[0];
writeFileSync(join(workspace, entry.source_path), '<root><GrimoireCrashAdvisoryTest id="GrimoireCrashAdvisoryTest" /></root>\n');
entry.entry = 'panorama/layout/hud.vxml_c';
manifest.entries = [entry];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const vpk = join(output, 'DO_NOT_PLAY_HUD_CRASH_TEST_dir.vpk');
// Keep the compiler's fidelity check enabled. Never silently pack stale bytes.
run(['panorama', 'build', '--workspace', workspace, '--output', vpk]);
console.log(`Created intentional HUD crash fixture: ${vpk}`);
