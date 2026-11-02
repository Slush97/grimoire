// A vpkmerge runner for dev scripts, outside Electron: the bundled binary (or $VPKMERGE).

import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VpkmergeRunner } from '../../electron/main/services/heroParticleSources';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function nodeVpkmergePath(): string {
  return process.env.VPKMERGE ?? join(root, 'resources/vpkmerge', process.platform === 'win32' ? 'vpkmerge-windows-x86_64.exe' : 'vpkmerge-linux-x86_64');
}

export function nodeVpkmerge(binary = nodeVpkmergePath()): VpkmergeRunner {
  return {
    stdout: (args) => new Promise((resolvePromise, reject) => {
      execFile(binary, args, { maxBuffer: 1 << 30, windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error(`vpkmerge ${args[0]} failed: ${stderr || error.message}`));
        else resolvePromise(stdout);
      });
    }),
  };
}

/**
 * A runner that sends the stored format queries (soundevents --with-format, and its --help probe) to
 * another vpkmerge build, for trying that flag before a release ships it.
 */
export function withFormatVpkmerge(base: VpkmergeRunner, formatBinary: string): VpkmergeRunner {
  const format = nodeVpkmerge(formatBinary);
  return {
    stdout: (args) => (args[0] === 'soundevents' && (args.includes('--with-format') || args.includes('--help')) ? format : base).stdout(args),
  };
}

/**
 * A runner that sends texture dumps (panorama dump, and its --help probe) to another vpkmerge build,
 * for trying the stored mip export (--mips) before a release ships it.
 */
export function withMipsVpkmerge(base: VpkmergeRunner, mipsBinary: string): VpkmergeRunner {
  const mips = nodeVpkmerge(mipsBinary);
  return {
    stdout: (args) => (args[0] === 'panorama' && args[1] === 'dump' ? mips : base).stdout(args),
  };
}

export const DEFAULT_DEADLOCK = process.env.DEADLOCK_PATH ?? 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock';
