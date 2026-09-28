import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getDisabledPath } from './deadlock';
import { assertVpkSafety, moveSafetySnapshot } from './modSafety';

/** Commit an inspected copy outside the game's search paths, without asking for activation consent. */
export async function importDisabledVpk(deadlockPath: string, source: string): Promise<string> {
    const folder = getDisabledPath(deadlockPath);
    await fs.mkdir(folder, { recursive: true });
    const destination = join(folder, `local_${randomUUID()}_dir.vpk`);
    const staged = `${destination}.tmp`;
    let claimed = false;
    try {
        await fs.copyFile(source, staged);
        await assertVpkSafety(staged, { prompt: false, allowUntrusted: true });
        const reservation = await fs.open(destination, 'wx');
        claimed = true;
        await reservation.close();
        await fs.rename(staged, destination);
        moveSafetySnapshot(staged, destination);
        return destination;
    } catch (err) {
        if (claimed) await fs.unlink(destination).catch(() => {});
        throw err;
    } finally {
        await fs.unlink(staged).catch(() => {});
    }
}
