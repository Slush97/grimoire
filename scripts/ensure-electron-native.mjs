#!/usr/bin/env node
// Ensure better-sqlite3 is compiled against the installed Electron ABI before
// launching `pnpm dev`. Skips in a few milliseconds when the stamp matches the
// current Electron version, platform, arch, and binary stats. Pass `--force`
// to rebuild unconditionally (used by `pnpm rebuild:electron`).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const force = process.argv.includes('--force');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronPkgPath = resolve(root, 'node_modules/electron/package.json');
const sqliteDir = resolve(root, 'node_modules/better-sqlite3');
const binaryPath = resolve(sqliteDir, 'build/Release/better_sqlite3.node');
const stampPath = resolve(root, 'node_modules/.cache/grimoire-electron-abi');
const rebuildCli = resolve(root, 'node_modules/@electron/rebuild/lib/cli.js');

if (!existsSync(electronPkgPath) || !existsSync(sqliteDir)) {
  process.exit(0);
}

if (!existsSync(rebuildCli)) {
  console.error('[predev] Missing @electron/rebuild CLI; run `pnpm install` first.');
  process.exit(1);
}

const electronVersion = JSON.parse(readFileSync(electronPkgPath, 'utf8')).version;

function currentStamp() {
  if (!existsSync(binaryPath)) return null;
  const st = statSync(binaryPath);
  return `${electronVersion}:${process.platform}:${process.arch}:${st.size}:${Math.trunc(st.mtimeMs)}`;
}

const expected = currentStamp();
if (!force && expected && existsSync(stampPath)) {
  const recorded = readFileSync(stampPath, 'utf8').trim();
  if (recorded === expected) {
    process.exit(0);
  }
}

console.log(`[predev] Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
try {
  execFileSync(process.execPath, [rebuildCli, '-f', '-w', 'better-sqlite3'], {
    cwd: root,
    stdio: 'inherit',
  });
} catch (err) {
  const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
    ? err.status
    : 1;
  process.exit(status);
}

const builtStamp = currentStamp();
if (builtStamp) {
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, `${builtStamp}\n`, 'utf8');
}
