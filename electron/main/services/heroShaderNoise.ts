import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runVpkmerge } from './modMerger';

// Read the installed resource on demand. No game texture ships with Grimoire.
let pending: { key: string; result: Promise<string> } | undefined;

export async function getHeroShaderNoise(deadlockPath: string): Promise<string> {
    const vpk = join(deadlockPath, 'game', 'core', 'pak01_dir.vpk');
    const stat = await fs.stat(vpk);
    const key = `${vpk}:${stat.size}:${stat.mtimeMs}`;
    if (pending?.key === key) return pending.result;
    const result = (async () => {
        const scratch = await fs.mkdtemp(join(tmpdir(), 'grimoire-shader-noise-'));
        try {
            await runVpkmerge(['panorama', 'dump', '--vpk', vpk, '--out-dir', scratch,
                '--prefix', 'textures/dev/blue_noise_256.vtex_c']);
            const png = await fs.readFile(join(scratch, 'textures/dev/blue_noise_256.png'));
            return `data:image/png;base64,${png.toString('base64')}`;
        } finally {
            await fs.rm(scratch, { recursive: true, force: true });
        }
    })();
    pending = { key, result };
    try { return await result; }
    catch (error) { if (pending?.result === result) pending = undefined; throw error; }
}
