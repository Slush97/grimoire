import { CrashHistory } from './crashHistory';
import { getActiveDeadlockPath } from './settings';
import { getSteamRoots } from './steamRoots';
import { getCrashReportContext } from './crashAdvisories';

let current: { path: string; history: CrashHistory } | undefined;
export function crashHistory(): CrashHistory {
    const path = getActiveDeadlockPath() ?? '';
    if (!current || current.path !== path) {
        current = { path, history: new CrashHistory(path, getSteamRoots(), path ? (time, entry) => getCrashReportContext(path, time, entry) : undefined) };
    }
    return current.history;
}
