import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Replay tracked TypeScript changes without another checkout or copying assets.
export function sourceRefPlugin(root, sourceRef) {
  const sources = new Map();
  if (sourceRef) {
    const changed = execFileSync('git', ['diff', '--name-only', sourceRef], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
    for (const path of changed.filter((path) => /^src\/.*\.tsx?$/.test(path))) {
      try { sources.set(resolve(root, path), execFileSync('git', ['show', `${sourceRef}:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })); }
      catch { /* New dev helpers remain available for capturing the baseline. */ }
    }
  }
  return { name: 'source-ref', enforce: 'pre', load(id) { return sources.get(resolve(id.split('?')[0])); } };
}
