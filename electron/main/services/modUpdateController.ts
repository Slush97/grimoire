import type { DownloadModArgs } from '../../../src/types/electron';
import type { GameBananaModDetails } from '../../../src/types/gamebanana';
import type { Mod } from '../../../src/types/mod';
import type { ChooseModUpdateReplacementArgs, ModUpdateState } from '../../../src/types/modUpdates';
import { classifyModFiles } from '../../../src/lib/updateFileMatch';
import { resolveUpdateRun } from '../../../src/lib/updateActions';
import { mergeSourceFileIds } from '../../../src/lib/updateCheck';
import { visibleInstalledMods } from '../../../src/lib/visibleMods';

export interface ModUpdateContext {
    deadlockPath: string;
    devMode: boolean;
}

interface UpdateGroup {
    id: string;
    modId: number;
    modName: string;
    section: string;
    pending: Map<number, string[]>;
    expected: Map<string, Mod>;
    removed: boolean;
}

function addPendingSources(group: UpdateGroup, fileId: number, sources: string[]) {
    group.pending.set(fileId, [...new Set([...(group.pending.get(fileId) ?? []), ...sources])]);
}

interface Dependencies {
    context: () => ModUpdateContext;
    mods: (path: string) => Promise<Mod[]>;
    details: (modId: number, section: string) => Promise<GameBananaModDetails>;
    autoMatchRemainingFiles: () => boolean;
    snapshot: (path: string) => Promise<unknown>;
    /** Must append synchronously before returning its completion promise. */
    replace: (path: string, args: DownloadModArgs, sources: string[], promote: boolean, expectedSources: Mod[]) => Promise<unknown>;
    targetQueued: (modId: number, fileId: number) => boolean;
    cancelled: (error: unknown) => boolean;
    publish: (state: ModUpdateState) => void;
}

/** Matching finishes for the whole batch before any replacement enters FIFO. */
export function createModUpdateController(deps: Dependencies) {
    let context: ModUpdateContext | null = null;
    let jobs = 0;
    let revision = 0;
    let sequence = 0;
    let snapshotAttempted = false;
    let errors: ModUpdateState['errors'] = [];
    let affectedModIds = new Set<number>();
    const groups = new Map<string, UpdateGroup>();
    const reservedSources = new Set<string>();
    const reservedTargets = new Set<string>();
    const validatingSources = new Set<string>();
    const preparingSources = new Set<string>();
    const pendingChoices = new Set<{ modId: number; fileId: number; cancelled: boolean }>();
    let preparation = Promise.resolve();

    // Only preparation is serialized here. Transfer and finalization belong to FIFO.
    const prepare = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = preparation.then(operation);
        preparation = result.then(() => {}, () => {});
        return result;
    };
    const reserveValidation = (sources: string[]) => {
        if (sources.some(id => preparingSources.has(id) || validatingSources.has(id) || reservedSources.has(id))) {
            throw new Error('This installed file is already being updated.');
        }
        sources.forEach(id => validatingSources.add(id));
        return () => sources.forEach(id => validatingSources.delete(id));
    };

    const hasPending = () => [...groups.values()].some(group => group.pending.size > 0);
    const updatingSources = () => new Set([
        ...preparingSources, ...validatingSources, ...reservedSources,
        ...[...groups.values()].flatMap(group => [...group.pending.values()].flat()),
    ]);
    const busy = () => preparingSources.size > 0 || jobs > 0 || hasPending();
    const getState = (): ModUpdateState => ({
        busy: busy(), preparing: preparingSources.size > 0, revision,
        updatingModIds: [...updatingSources()],
        affectedModIds: [...affectedModIds],
        errors: errors.map(error => ({ ...error })),
        manualRequests: [...groups.values()].filter(group => group.pending.size > 0).map(group => ({
            id: group.id, modId: group.modId, modName: group.modName, section: group.section,
            sourceFileIds: [...group.pending.keys()],
            sourceModIds: [...group.pending.values()].flat(),
        })),
    });
    const publish = (installedChanged = false) => {
        if (!busy()) context = null;
        if (installedChanged) revision++;
        deps.publish(getState());
    };
    const fail = (modId: number, modName: string, error: unknown) => {
        errors.push({ id: String(++sequence), modId, modName, message: error instanceof Error ? error.message : String(error) });
    };
    const assertContext = () => {
        const current = deps.context();
        if (context && (current.deadlockPath !== context.deadlockPath || current.devMode !== context.devMode)) {
            throw new Error('The active mod installation changed during updating.');
        }
        return context ?? current;
    };
    const begin = () => {
        context = deps.context();
        groups.clear();
        errors = [];
        affectedModIds = new Set();
        snapshotAttempted = false;
    };
    const snapshot = async () => {
        const path = assertContext().deadlockPath;
        if (snapshotAttempted) return;
        snapshotAttempted = true;
        try { await deps.snapshot(path); }
        catch (error) { console.warn('[mod-updates] Recovery snapshot failed:', error); }
    };

    function enqueue(group: UpdateGroup, args: DownloadModArgs, sources: string[], promote: boolean, expectedSources: Mod[], manualFileId?: number) {
        const target = `${args.modId}:${args.fileId}`;
        if (reservedTargets.has(target) || deps.targetQueued(args.modId, args.fileId)) {
            throw new Error('This replacement file is already queued.');
        }
        if (sources.some(id => reservedSources.has(id))) throw new Error('This installed file is already being updated.');
        const path = assertContext().deadlockPath;
        reservedTargets.add(target);
        sources.forEach(id => reservedSources.add(id));
        jobs++;
        affectedModIds.add(group.modId);
        // The executor appends immediately, so Browse cannot jump earlier batch jobs.
        let completion: Promise<unknown>;
        try { completion = deps.replace(path, args, sources, promote, expectedSources); }
        catch (error) { completion = Promise.reject(error); }
        void completion.catch(async error => {
            if (deps.cancelled(error)) return;
            fail(group.modId, group.modName, error);
            if (manualFileId !== undefined && !group.removed) {
                // Cleanup may already have completed before a state restore failed.
                // Only offer a retry when the predecessor still exists.
                try {
                    const installed = await deps.mods(path);
                    const remaining = sources.filter(id => installed.some(mod => {
                        const expected = expectedSources.find(source => source.id === id);
                        return mod.id === id && expected && mod.gameBananaId === expected.gameBananaId &&
                            mod.gameBananaFileId === expected.gameBananaFileId && mod.size === expected.size &&
                            mod.installedAt === expected.installedAt && (!expected.sha256 || expected.sha256 === mod.sha256);
                    }));
                    if (remaining.length > 0 && !group.removed) addPendingSources(group, manualFileId, remaining);
                } catch (scanError) { console.warn('[mod-updates] Could not recover replacement choice:', scanError); }
            }
        }).finally(() => {
            reservedTargets.delete(target);
            sources.forEach(id => reservedSources.delete(id));
            jobs--;
            publish(true);
        });
        return completion;
    }

    async function start(modIds: string[]) {
        const updating = updatingSources();
        const selected = new Set(modIds.filter(id => !updating.has(id)));
        if (selected.size === 0) return;
        if (!busy()) begin();
        selected.forEach(id => preparingSources.add(id));
        publish();
        try {
            await prepare(async () => {
                const installed = visibleInstalledMods(await deps.mods(assertContext().deadlockPath));
                const targets = installed.filter(mod => selected.has(mod.id) && !mod.ignoreUpdates && typeof mod.gameBananaId === 'number');
                const bySubmission = new Map<string, Mod[]>();
                for (const mod of targets) {
                    const key = `${mod.sourceSection ?? 'Mod'}:${mod.gameBananaId}`;
                    const entries = bySubmission.get(key) ?? [];
                    entries.push(mod);
                    bySubmission.set(key, entries);
                }
                const automatic: Array<{ group: UpdateGroup; args: DownloadModArgs; sources: string[]; promote: boolean }> = [];
                const autoMatch = deps.autoMatchRemainingFiles();
                for (const [key, selectedMods] of bySubmission) {
                    const modId = selectedMods[0].gameBananaId!;
                    const section = selectedMods[0].sourceSection ?? 'Mod';
                    affectedModIds.add(modId);
                    try {
                        const details = await deps.details(modId, section);
                        assertContext();
                        const group = [...groups.values()].find(candidate => candidate.modId === modId && candidate.section === section && !candidate.removed)
                            ?? { id: `${++sequence}:${key}`, modId, section, modName: details.name, pending: new Map<number, string[]>(), expected: new Map<string, Mod>(), removed: false };
                        group.modName = details.name;
                        selectedMods.forEach(mod => group.expected.set(mod.id, { ...mod }));
                        groups.set(group.id, group);
                        const scope = installed.filter(mod => (mod.sourceSection ?? 'Mod') === section);
                        const classification = classifyModFiles(modId, details.files ?? [], scope, mergeSourceFileIds(scope), autoMatch);
                        const destinations = new Map<number, { sources: string[]; promote: boolean }>();
                        for (const step of resolveUpdateRun(classification, selectedMods)) {
                            if (step.kind === 'needs-pick') {
                                const old = selectedMods.find(mod => mod.id === step.modId)!;
                                addPendingSources(group, old.gameBananaFileId!, [old.id]);
                            } else if (step.kind === 'update') {
                                const job = destinations.get(step.fileId) ?? { sources: [], promote: step.promote };
                                job.sources.push(step.modId);
                                destinations.set(step.fileId, job);
                            }
                        }
                        for (const [fileId, job] of destinations) {
                            const file = details.files!.find(file => file.id === fileId)!;
                            automatic.push({ group, sources: job.sources, promote: job.promote, args: {
                                modId, fileId, fileName: file.fileName, modName: details.name, section,
                                categoryId: selectedMods[0].categoryId, isReplacement: true,
                            } });
                        }
                    } catch (error) { fail(modId, selectedMods[0].name, error); }
                }
                // A single recovery point covers automatic jobs and later manual choices.
                if (automatic.length > 0 || hasPending()) await snapshot();
                for (const job of automatic) {
                    try { enqueue(job.group, job.args, job.sources, job.promote, installed.filter(mod => job.sources.includes(mod.id))); }
                    catch (error) { fail(job.group.modId, job.group.modName, error); }
                }
            });
        } finally {
            selected.forEach(id => preparingSources.delete(id));
            publish(jobs === 0);
        }
    }

    async function choose({ requestId, oldFileId, newFileId }: ChooseModUpdateReplacementArgs) {
        const group = groups.get(requestId);
        const sources = group?.pending.get(oldFileId);
        if (!group || !sources) throw new Error('This replacement is no longer pending.');
        if (oldFileId === newFileId) throw new Error('Invalid replacement file.');
        const releaseValidation = reserveValidation(sources);
        const choice = { modId: group.modId, fileId: newFileId, cancelled: false };
        pendingChoices.add(choice);
        // Reserve before validation so double clicks cannot submit the same source.
        group.pending.delete(oldFileId);
        jobs++;
        publish();
        try {
            await prepare(async () => {
                if (choice.cancelled) return;
                const path = assertContext().deadlockPath;
                if (group.removed) throw new Error('This replacement request was removed.');
                // The picker fetches current uploads when opened. Validate against
                // those uploads without changing the captured predecessor proof.
                const details = await deps.details(group.modId, group.section);
                if (choice.cancelled) return;
                assertContext();
                if (group.removed) throw new Error('This replacement request was removed.');
                const file = details.files?.find(file => file.id === newFileId && !file.isArchived);
                if (!file) throw new Error('Invalid replacement file.');
                const installed = visibleInstalledMods(await deps.mods(path));
                if (choice.cancelled) return;
                if (group.removed) throw new Error('This replacement request was removed.');
                if (installed.some(mod => mod.gameBananaId === group.modId && mod.gameBananaFileId === newFileId && (mod.sourceSection ?? 'Mod') === group.section) || mergeSourceFileIds(installed).has(newFileId)) {
                    throw new Error('This replacement file is already installed.');
                }
                if (!sources.every(id => installed.some(mod => mod.id === id))) throw new Error('The file being replaced has changed.');
                // The completion handler owns retry and error state after submission.
                enqueue(group, { modId: group.modId, fileId: newFileId, fileName: file.fileName, modName: group.modName, section: group.section, isReplacement: true }, sources, false, sources.map(id => group.expected.get(id)!), oldFileId);
            });
        } catch (error) {
            if (choice.cancelled) return;
            if (!group.removed) addPendingSources(group, oldFileId, sources);
            throw error;
        } finally {
            pendingChoices.delete(choice);
            releaseValidation();
            jobs--;
            publish();
        }
    }

    /** Cancel the optimistic queue row before its validated download is enqueued. */
    function cancelPendingChoiceTarget(modId: number, fileId: number): boolean {
        let cancelled = false;
        for (const choice of pendingChoices) {
            if (choice.modId !== modId || choice.fileId !== fileId || choice.cancelled) continue;
            choice.cancelled = true;
            cancelled = true;
        }
        return cancelled;
    }

    function remove(requestId: string) {
        const group = groups.get(requestId);
        if (!group) return;
        group.removed = true;
        group.pending.clear();
        publish();
    }

    /** Details-page updates and reinstalls use the same queue finalizer. */
    async function replace(args: DownloadModArgs) {
        const sources = [...new Set(args.replacementModIds)];
        if (sources.length === 0) throw new Error('No installed replacement source was selected.');
        const newBatch = !busy();
        if (newBatch) begin();
        const releaseValidation = reserveValidation(sources);
        const choice = { modId: args.modId, fileId: args.fileId, cancelled: false };
        pendingChoices.add(choice);
        jobs++;
        affectedModIds.add(args.modId);
        publish();
        let group: UpdateGroup | undefined;
        let manualFileId: number | undefined;
        let submitted = false;
        try {
            // Capture identity now, before another session's lengthy matching pass.
            // Handle rejection immediately while this operation waits its turn.
            const requested = deps.mods(assertContext().deadlockPath).then(
                installed => ({ sources: installed.filter(mod => sources.includes(mod.id)).map(mod => ({ ...mod })) }),
                error => ({ error }),
            );
            const prepared = await prepare(async () => {
                const initial = await requested;
                if (choice.cancelled) return;
                if ('error' in initial) throw initial.error;
                if (initial.sources.length !== sources.length) throw new Error('The file being replaced has changed.');
                const path = assertContext().deadlockPath;
                const installed = visibleInstalledMods(await deps.mods(path));
                if (choice.cancelled) return;
                if (!sources.every(id => installed.some(mod => mod.id === id))) throw new Error('The file being replaced has changed.');
                if (sources.some(id => reservedSources.has(id))) throw new Error('This installed file is already being updated.');
                const section = args.section ?? 'Mod';
                for (const candidate of groups.values()) {
                    if (candidate.modId !== args.modId || candidate.section !== section) continue;
                    const entry = [...candidate.pending].find(([, ids]) => ids.length === sources.length && ids.every(id => sources.includes(id)));
                    if (entry) {
                        group = candidate;
                        manualFileId = entry[0];
                        candidate.pending.delete(manualFileId);
                        break;
                    }
                }
                group ??= { id: String(++sequence), modId: args.modId, modName: args.modName ?? String(args.modId), section,
                    pending: new Map(), expected: new Map(), removed: false };
                const promote = installed.some(mod => mod.gameBananaId === args.modId && mod.gameBananaFileId === args.fileId && (mod.sourceSection ?? 'Mod') === section && !sources.includes(mod.id));
                await snapshot();
                if (choice.cancelled) return;
                const expectedSources = manualFileId === undefined ? initial.sources : sources.map(id => group!.expected.get(id)!);
                const completion = enqueue(group, { ...args, isReplacement: true }, sources, promote, expectedSources, manualFileId);
                submitted = true;
                pendingChoices.delete(choice);
                return { completion };
            });
            releaseValidation();
            await prepared?.completion;
        } catch (error) {
            if (choice.cancelled && !submitted) return;
            if (!submitted && group && manualFileId !== undefined && !group.removed) addPendingSources(group, manualFileId, sources);
            throw error;
        } finally {
            pendingChoices.delete(choice);
            releaseValidation();
            jobs--;
            publish();
        }
    }

    return { start, choose, remove, replace, cancelPendingChoiceTarget, getState, isBusy: busy };
}
