// Fetches ValveResourceFormat at the pinned commit into .codex-run/vrf-src (gitignored)
// and builds the particle oracle. Dev-only: nothing here ships with the app.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Bump together with any port that relies on newer VRF behavior.
const VRF_COMMIT = '7c55bc278ef05726e764f0b590c6d252481574c9';
const root = fileURLToPath(new URL('../..', import.meta.url));
const vrf = join(root, '.codex-run', 'vrf-src');
const git = (...args) => execFileSync('git', args, { cwd: vrf, stdio: 'inherit' });

if (!existsSync(join(vrf, '.git'))) {
  execFileSync('git', ['init', '-q', vrf], { stdio: 'inherit' });
  git('remote', 'add', 'origin', 'https://github.com/ValveResourceFormat/ValveResourceFormat.git');
}
git('fetch', '-q', '--depth', '1', 'origin', VRF_COMMIT);
git('checkout', '-q', '--detach', VRF_COMMIT);
execFileSync('dotnet', ['build', '-c', 'Release', join(root, 'tools', 'particle-oracle', 'ParticleOracle.csproj')], { stdio: 'inherit' });
