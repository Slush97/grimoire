/*
 * app.mjs
 * Launches a throwaway Grimoire from any checkout, with
 * its own userData and a fake Deadlock install, fenced off from this machine
 * the same way scripts/guide-shots/app.mjs is: fake HOME, no D-Bus, and stub
 * xdg-open/gio/steam/pgrep/pkill on PATH.
 *
 * Everything shared lives in QA_HOME (default ~/.cache/grimoire-qa): the
 * fixtures, the stubs, and the slot lock that caps how many apps run at once
 * across every worktree (QA_SLOTS, default 3), so parallel agents neither
 * fight over Xvfb display numbers nor run the machine out of RAM.
 *
 * Launched from any checkout (--repo) under Xvfb by default, or as a real
 * window with --visible (see launch()).
 */
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sleep } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const QA_HOME = process.env.QA_HOME || join(homedir(), '.cache', 'grimoire-qa');
const SLOTS = Number(process.env.QA_SLOTS) || 3;
const SLOT_DIR = join(QA_HOME, 'slots');
// Visible runs share the real GPU and display, so only one at a time.
const VISIBLE_SLOT_DIR = join(QA_HOME, 'slots-visible');
const BIN_DIR = join(QA_HOME, 'bin');

export const fixtureDir = (name) => join(QA_HOME, `fixture-${name}`);

export function context(repo) {
  const REPO = resolve(repo);
  const id = process.env.QA_RUN || basename(REPO);
  const RUN = join(QA_HOME, `run-${id}`);
  return {
    REPO,
    id,
    RUN,
    PROFILE: join(RUN, 'profile'),
    HOME_DIR: join(QA_HOME, `home-${id}`),
    RESULTS: join(QA_HOME, 'results', id),
  };
}

/** Settings every run starts from: default look, every tab on, nothing that phones home. */
export function baseSettings(fakeGame) {
  return {
    deadlockPath: fakeGame,
    devMode: false,
    hasCompletedSetup: true,
    language: 'en',
    zoomFactor: 1,
    accentColor: '#f97316',
    oledMode: false,
    nsfwContentMode: 'blur',
    autoCheckAppUpdates: false,
    autoCheckModUpdates: false,
    discordRpcEnabled: false,
    contributeMatchSalts: false,
    experimentalStats: true,
    experimentalCrosshair: true,
    experimentalFoundry: true,
    experimentalDeadworksServers: true,
    experimentalSocial: true,
    // Any hidden creator routes Browse to the local catalog mirror instead of
    // the live GameBanana API. This id matches nobody.
    hiddenCreators: [{ id: 999_999_999, name: 'grimoire-qa' }],
    windowBounds: { x: 0, y: 0, width: 1280, height: 800, isMaximized: false },
  };
}

/*
 * Copy a run or fixture tree. VPKs are hardlinked (the app renames and
 * deletes them but never edits one in place), JSON is rewritten so absolute
 * paths follow the new root, and symlinks into the old root are retargeted.
 * Chromium's own caches are skipped: they are big and only add noise.
 */
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'logs']);
const SKIP_FILES = /^(Singleton(Lock|Socket|Cookie)|DevToolsActivePort|app\.log|app\.json)$/;

function copyTree(src, dst, fromRoot, toRoot) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name) || SKIP_FILES.test(name)) continue;
    const from = join(src, name);
    const to = join(dst, name);
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(from);
      symlinkSync(target.startsWith(fromRoot) ? toRoot + target.slice(fromRoot.length) : target, to);
    } else if (stat.isDirectory()) {
      copyTree(from, to, fromRoot, toRoot);
    } else if (name.endsWith('.vpk')) {
      linkSync(from, to);
    } else if (name.endsWith('.json')) {
      writeFileSync(to, readFileSync(from, 'utf8').split(fromRoot).join(toRoot));
    } else {
      copyFileSync(from, to);
    }
  }
}

const rootOf = (dir) => readFileSync(join(dir, '.root'), 'utf8').trim();

/*
 * The base fixture is the guide-shots demo install (14 popular mods, two
 * profiles). Import it once from a guide-shots checkout.
 */
function importBase() {
  const from =
    process.env.QA_FIXTURE_SRC || join(homedir(), 'grimoire-workspace/grimoire-wt-guide-shots/.guide-shots/fixture');
  if (!existsSync(from)) throw new Error(`no guide-shots fixture at ${from}; set QA_FIXTURE_SRC`);
  // The guide-shots base fixture predates .root and was built in .guide-shots/run.
  const oldRoot = existsSync(join(from, '.root')) ? rootOf(from) : resolve(from, '..', 'run');
  const dst = fixtureDir('base');
  copyTree(from, dst, oldRoot, dst);
  writeFileSync(join(dst, '.root'), dst);
}

/*
 * The stress fixture adds STRESS_CLONES disabled copies of the base mods
 * (hardlinked VPKs plus cloned metadata), so Installed, Locker and Profiles
 * have a few hundred cards to lay out and scroll, like a heavy user's install.
 * Clones stay off: turning them on would make every one a conflict.
 */
const STRESS_CLONES = 240;

function buildStress() {
  const base = fixtureDir('base');
  const dst = fixtureDir('stress');
  copyTree(base, dst, rootOf(base), dst);
  writeFileSync(join(dst, '.root'), dst);

  const disabled = join(dst, 'Deadlock', 'game', 'citadel', 'addons', '.disabled');
  const metaFile = join(dst, 'profile', 'mod-metadata.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const sources = readdirSync(disabled).filter((f) => f.endsWith('_dir.vpk') && meta[f]);
  if (sources.length === 0) throw new Error('base fixture has no disabled mods with metadata to clone');
  for (let i = 0; i < STRESS_CLONES; i++) {
    const src = sources[i % sources.length];
    const name = src.replace(/_dir\.vpk$/, `_qa${String(i).padStart(3, '0')}_dir.vpk`);
    linkSync(join(disabled, src), join(disabled, name));
    // Fake GameBanana ids, or every clone groups into its source as a variant.
    meta[name] = {
      ...meta[src],
      modName: `${meta[src].modName} ${i + 1}`,
      gameBananaId: 900_000_000 + i,
      gameBananaFileId: 900_000_000 + i,
      variantLabel: null,
      sourceFileName: name.replace(/_dir\.vpk$/, ''),
    };
  }
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}

export function ensureFixture(name) {
  if (!existsSync(fixtureDir('base'))) importBase();
  if (name === 'stress' && !existsSync(fixtureDir('stress'))) buildStress();
  if (!existsSync(fixtureDir(name))) throw new Error(`unknown fixture ${name}`);
}

/** Reset the run directory to a fresh copy of a fixture, with QA settings on top. */
export function runFromFixture(ctx, name) {
  ensureFixture(name);
  const dir = fixtureDir(name);
  rmSync(ctx.RUN, { recursive: true, force: true });
  copyTree(dir, ctx.RUN, rootOf(dir), ctx.RUN);
  rmSync(join(ctx.RUN, '.root'), { force: true });
  const file = join(ctx.PROFILE, 'settings.json');
  const current = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...current, ...baseSettings(join(ctx.RUN, 'Deadlock')) }, null, 2));
  // A catalog older than 24h starts a full GameBanana sync on boot, which
  // re-renders the UI for minutes and makes every number depend on the network.
  const db = new DatabaseSync(join(ctx.PROFILE, 'mods-cache.db'));
  db.prepare('UPDATE sync_state SET last_sync = ?').run(Math.floor(Date.now() / 1000));
  db.close();
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/*
 * A slot is a directory holding a heartbeat file the owner touches every 2s.
 * Liveness is judged by the heartbeat's age, not by PID: Codex agents run in
 * their own PID namespaces, where another agent's PID means nothing.
 */
const HEARTBEAT_MS = 2000;
const STALE_MS = 15_000;

async function acquireSlot(slotDir, slots) {
  mkdirSync(slotDir, { recursive: true });
  for (let waited = 0; ; waited++) {
    for (let i = 0; i < slots; i++) {
      const dir = join(slotDir, String(i));
      const beat = join(dir, 'heartbeat');
      try {
        mkdirSync(dir);
        writeFileSync(beat, String(Date.now()));
        const timer = setInterval(() => {
          try {
            writeFileSync(beat, String(Date.now()));
          } catch {
            // Released underneath us; stop() is on its way.
          }
        }, HEARTBEAT_MS);
        timer.unref();
        return { slot: i, release: () => (clearInterval(timer), rmSync(dir, { recursive: true, force: true })) };
      } catch {
        let last = 0;
        try {
          last = statSync(beat).mtimeMs;
        } catch {
          // Mid-claim, or a pre-heartbeat slot: judge by the directory instead.
          try {
            last = statSync(dir).mtimeMs;
          } catch {
            continue;
          }
        }
        if (Date.now() - last > STALE_MS) rmSync(dir, { recursive: true, force: true });
      }
    }
    if (waited % 20 === 0) console.log(`  waiting for an app slot (${slots} in use across worktrees)...`);
    await sleep(1500);
  }
}

async function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(250);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function writeStubs() {
  mkdirSync(BIN_DIR, { recursive: true });
  for (const name of ['xdg-open', 'gio', 'gvfs-open', 'kde-open', 'kde-open5', 'steam', 'pkill', 'pgrep']) {
    const code = name === 'pgrep' ? 1 : 0;
    writeFileSync(join(BIN_DIR, name), `#!/bin/sh\necho "[grimoire-qa] blocked: ${name} $*" >&2\nexit ${code}\n`, {
      mode: 0o755,
    });
  }
}

/*
 * Headless by default: Xvfb with SwiftShader, so several agents can measure
 * at once. Paint and compositing costs are inflated there (no GPU), so trust
 * commits, layouts, long tasks and TBT over frame times.
 *
 * visible: a real window on this machine's Wayland session with the real
 * GPU, one run at a time. Use it for the numbers that get reported. The
 * window has to stay on a visible workspace, or the compositor stops frame
 * callbacks and every frame metric is garbage (perf.mjs checks for that).
 */
export async function launch(ctx, { visible = false } = {}) {
  if (!existsSync(join(ctx.REPO, 'dist', 'main', 'index.js'))) {
    throw new Error(`${ctx.REPO} has no build; run with --build or build it first`);
  }
  if (visible && !process.env.WAYLAND_DISPLAY) throw new Error('--visible needs a Wayland session (WAYLAND_DISPLAY)');
  const slotDir = visible ? VISIBLE_SLOT_DIR : SLOT_DIR;
  const { slot, release } = await acquireSlot(slotDir, visible ? 1 : SLOTS);
  const out = openSync(join(ctx.RUN, 'app.log'), 'a');
  writeStubs();
  mkdirSync(ctx.HOME_DIR, { recursive: true });
  const env = {
    ...process.env,
    HOME: ctx.HOME_DIR,
    XDG_CONFIG_HOME: join(ctx.HOME_DIR, '.config'),
    XDG_DATA_HOME: join(ctx.HOME_DIR, '.local', 'share'),
    XDG_CACHE_HOME: join(ctx.HOME_DIR, '.cache'),
    PATH: `${BIN_DIR}:${process.env.PATH}`,
  };
  delete env.DBUS_SESSION_BUS_ADDRESS;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_OZONE_PLATFORM_HINT;
  if (!visible) {
    delete env.WAYLAND_DISPLAY;
    delete env.XDG_SESSION_TYPE;
    // Electron otherwise picks the host NVIDIA EGL driver, which crashes Xvfb
    // (an "X connection error" that kills the app mid-run). Mesa keeps every
    // headless run on the same software renderer.
    const mesa = '/usr/share/glvnd/egl_vendor.d/50_mesa.json';
    if (existsSync(mesa)) env.__EGL_VENDOR_LIBRARY_FILENAMES = mesa;
  }
  // Keep the app off the internet: see net-shim.cjs. It runs from QA_HOME
  // because under a checkout, require('electron') resolves to the npm
  // package (a path string) instead of Electron's built-in API.
  const shim = join(QA_HOME, 'net-shim.cjs');
  copyFileSync(join(HERE, 'net-shim.cjs'), shim);
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require ${shim}`.trim();
  env.QA_NET_CACHE = join(QA_HOME, 'net-cache');
  const pinned = join(ctx.REPO, 'resources', 'vpkmerge', 'vpkmerge-linux-x86_64');
  if (existsSync(pinned)) env.VPKMERGE_BINARY = pinned;

  const electron = createRequire(join(ctx.REPO, 'package.json'))('electron');
  const portFile = join(ctx.PROFILE, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const appArgs = [
    ctx.REPO,
    `--user-data-dir=${ctx.PROFILE}`,
    '--remote-debugging-port=0',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
  ];
  const [cmd, args] = visible
    ? [electron, [...appArgs, '--ozone-platform=wayland']]
    : [
        'xvfb-run',
        [
          // Prefer one display per slot; -a falls back to the next free one.
          '-a',
          '-n',
          String(90 + slot),
          '-s',
          '-screen 0 1920x1200x24',
          electron,
          ...appArgs,
          '--enable-unsafe-swiftshader',
          // Electron 44 picks Wayland on its own; Xvfb is X11.
          '--ozone-platform=x11',
        ],
      ];
  const startedAt = Date.now();
  const child = spawn(cmd, args, { env, detached: true, stdio: ['ignore', out, out] });

  let port = null;
  for (let i = 0; i < 480 && !port; i++) {
    if (child.exitCode !== null) break;
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || null;
    if (!port) await sleep(125);
  }
  if (!port) {
    await killGroup(child.pid);
    release();
    throw new Error(`app did not start; see ${join(ctx.RUN, 'app.log')}`);
  }

  const stop = async () => {
    await killGroup(child.pid);
    release();
  };
  return { port, startedAt, stop };
}
