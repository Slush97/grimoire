import { resolve } from 'path';
import { CrashHistory } from './crashHistory';
import { getActiveDeadlockPath } from './settings';
import { getSteamRoots } from './steamRoots';
import { getCrashReportContext } from './crashAdvisories';

let current: { path: string; history: CrashHistory } | undefined;
export function crashHistory(): CrashHistory {
    const path = getActiveDeadlockPath() ?? '';
    if (!current || current.path !== path) {
        // crashAdvisories keys its state by the resolved path and resets on a mismatch.
        const gamePath = path && resolve(path);
        current = { path, history: new CrashHistory(gamePath, getSteamRoots(), gamePath ? (time, entry) => getCrashReportContext(gamePath, time, entry) : undefined) };
    }
    return current.history;
}
