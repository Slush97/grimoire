import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const vrf = resolve(root, '.codex-run/vrf-src');
const pinned = '7c55bc278ef05726e764f0b590c6d252481574c9';
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
if (!existsSync(resolve(vrf, '.git'))) {
  run('git', ['init', '-q', vrf]);
  run('git', ['remote', 'add', 'origin', 'https://github.com/ValveResourceFormat/ValveResourceFormat.git'], vrf);
}
run('git', ['fetch', '-q', '--depth', '1', 'origin', pinned], vrf);
run('git', ['checkout', '-q', '--detach', pinned], vrf);
run('dotnet', ['build', 'tools/hideout-oracle/HideoutOracle.csproj', '-c', 'Release', '-m:1', '-p:BuildInParallel=false']);
