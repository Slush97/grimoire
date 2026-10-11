export interface CrashResourceOwner {
    fingerprint: string;
    entryHash: string;
    name: string;
}

export interface CrashProvider {
    root: string;
    priority: number;
    fingerprint: string;
    name: string;
    files: Record<string, string>;
}

export interface CrashConfiguration {
    observedAt: number;
    gameBuild: string;
    source: 'observed' | 'launch';
    owners: Record<string, CrashResourceOwner>;
}

/** Lower pak numbers win within a root; earlier Game mounts win across roots. */
export function crashResourceOwners(providers: CrashProvider[], mounts: string[], stockEntries: Set<string>): Record<string, CrashResourceOwner> {
    const owners: Record<string, CrashResourceOwner> = {};
    const settled = new Set<string>();
    for (const root of mounts) {
        if (root === 'citadel' || root === 'core') {
            for (const entry of stockEntries) settled.add(entry);
            continue;
        }
        if (!/^citadel\/(grimoire|addons\d*)$/.test(root)) return {};
        const ordered = providers.filter(provider => provider.root === root).sort((a, b) => a.priority - b.priority);
        for (const provider of ordered) {
            for (const [entry, entryHash] of Object.entries(provider.files)) {
                if (settled.has(entry)) continue;
                settled.add(entry);
                // An unreadable resource or ambiguous slot can shadow a lower mod.
                if (!provider.fingerprint || !entryHash || ordered.some(other => other !== provider && other.priority === provider.priority && entry in other.files)) continue;
                owners[entry] = { fingerprint: provider.fingerprint, entryHash, name: provider.name };
            }
        }
    }
    return owners;
}

export function configurationForCrash(configurations: CrashConfiguration[], time: number): CrashConfiguration | undefined {
    return [...configurations].reverse().find(configuration => configuration.observedAt <= time);
}

/** Steam log timestamps use local time, unlike the UTC minidump header. */
export function steamBuildAt(log: string, time: number): string | undefined {
    let build: string | undefined;
    for (const line of log.split(/\r?\n/)) {
        if (!line.includes('AppID 1422450 finished update')) continue;
        const stamp = line.match(/^\[([\d-]+) ([\d:]+)\]/);
        const id = line.match(/BuildID (\d+)/);
        if (stamp && id && new Date(`${stamp[1]}T${stamp[2]}`).getTime() <= time) build = id[1];
    }
    return build;
}
