import { app } from 'electron';
import { createHash } from 'node:crypto';
import { constants, createReadStream, promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { compatibilityFindingsSchema, compatibilityBatchSchema, type CompatibilityReview, type CompatibilityRepairResult } from '../../../src/lib/modCompatibility';
import { getCitadelPath, metaKeyFor } from './deadlock';
import { assertCanMoveLoadedGameMod, syncRunningGameModSnapshotFromMods } from './gameSessionMods';
import { freezeLegacyVpkIndexes } from './imprintMods';
import { getModMetadata, setModMetadataWithHash } from './metadata';
import { runVpkmergeStdout } from './modMerger';
import { runExclusiveModMutation, scanMods } from './mods';
import { assertVpkSafety, carryVpkSafety, moveSafetySnapshot } from './modSafety';
import { modTempPath } from './modTemps';
import { retargetProfileModSha } from './profiles';
import { findChunkSiblingNames, parseVpkDirectoriesAsync, parseVpkEntryStats } from './vpk';

/** Any competing animation provider makes rig repair uncertain. Data repairs
 * remain available. Scan again under the mutation lock rather than trusting UI. */
export async function hasOtherAnimationOverrides(modPaths: string[], targetPath: string): Promise<boolean> {
    const trees = await parseVpkDirectoriesAsync(modPaths.filter((path) => path !== targetPath));
    return [...trees.values()].some((paths) => (paths === null || paths.some((path) => /\.(?:vnmskel|vnmclip|vnmgraph|vanmgrph|vanim|vagrp)_c$/i.test(path))));
}

async function fileHash(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    return hash.digest('hex');
}

export function repairModCompatibility(deadlockPath: string, modId: string): Promise<CompatibilityRepairResult> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        const mod = installed.find((entry) => entry.id === modId);
        if (!mod) throw new Error(`Mod not found: ${modId}`);
        await syncRunningGameModSnapshotFromMods(installed);
        assertCanMoveLoadedGameMod(mod);
        freezeLegacyVpkIndexes(installed);
        if (findChunkSiblingNames(mod.fileName, await fs.readdir(dirname(mod.path))).length > 0) {
            throw new Error('Split archives must be combined before repairing them.');
        }
        const overrides = await hasOtherAnimationOverrides(installed.filter((entry) => entry.enabled).map((entry) => entry.path), mod.path);
        const base = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
        const baseStamp = await fs.stat(base);
        const staged = modTempPath(dirname(mod.path), 'compatibility');
        const originalHash = await fileHash(mod.path);
        try {
            const reports = compatibilityFindingsSchema.parse(JSON.parse(await runVpkmergeStdout([
                'compatibility', 'heal', '--base', base,
                '--output', staged, '--json', ...(overrides ? ['--animation-overrides'] : []), mod.path,
            ])));
            const currentBase = await fs.stat(base);
            if (currentBase.size !== baseStamp.size || currentBase.mtimeMs !== baseStamp.mtimeMs) throw new Error('Deadlock updated during the repair. Try again.');
            const repaired = reports.filter((report) => report.status === 'repairable');
            if (repaired.length === 0) return { kind: 'unchanged' };
            const before = parseVpkEntryStats(mod.path);
            const after = parseVpkEntryStats(staged);
            if (!before || !after) throw new Error('Cannot verify the repaired archive.');
            const changed = new Set(repaired.map((report) => report.entry.toLowerCase()));
            const sizes = new Map(after.map((entry) => [entry.path.toLowerCase(), entry.size]));
            if (sizes.size !== new Set(before.map((entry) => entry.path.toLowerCase())).size
                || before.some((entry) => !sizes.has(entry.path.toLowerCase()) || (!changed.has(entry.path.toLowerCase()) && sizes.get(entry.path.toLowerCase()) !== entry.size))) {
                throw new Error('The repaired archive changed unrelated files.');
            }
            if (await carryVpkSafety([mod.path], staged) === 'differs') await assertVpkSafety(staged, { name: mod.name });
            if (await fileHash(mod.path) !== originalHash) throw new Error('The mod changed during repair. Try again.');
            const folder = join(app.getPath('userData'), 'mod-repair-backups');
            await fs.mkdir(folder, { recursive: true });
            const backupPath = join(folder, `${originalHash}.vpk`);
            try {
                await fs.copyFile(mod.path, backupPath, constants.COPYFILE_EXCL);
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
                if (await fileHash(backupPath) !== originalHash) throw new Error('The saved backup is damaged.', { cause: error });
            }
            if (await fileHash(backupPath) !== originalHash || await fileHash(mod.path) !== originalHash) {
                throw new Error('The mod changed while its backup was being saved. Try again.');
            }
            const metaKey = metaKeyFor(mod.path);
            const previousSha = getModMetadata(metaKey)?.sha256 ?? originalHash;
            let replacementSha: string | undefined;
            let retargetStarted = false;
            await fs.rename(staged, mod.path);
            try {
                await setModMetadataWithHash(metaKey, {}, mod.path);
                replacementSha = getModMetadata(metaKey)?.sha256;
                retargetStarted = true;
                retargetProfileModSha(previousSha, replacementSha);
                moveSafetySnapshot(staged, mod.path);
                return { kind: 'repaired', count: changed.size, backupPath };
            } catch (error) {
                try {
                    await fs.copyFile(backupPath, mod.path);
                    await setModMetadataWithHash(metaKey, {}, mod.path);
                    if (retargetStarted && replacementSha) retargetProfileModSha(replacementSha, previousSha);
                } catch (rollbackError) {
                    throw new AggregateError([error, rollbackError], `Repair could not finish. The original backup is saved at ${backupPath}`, { cause: rollbackError });
                }
                throw new Error('The repair could not be saved. The original mod was restored.', { cause: error });
            }
        } finally {
            await fs.rm(staged, { force: true });
        }
    }, { healPath: deadlockPath });
}

/** Read-only review. Re-run for every open so order, selection and external
 * changes cannot reuse a plan from an earlier library state. */
export async function reviewModCompatibility(deadlockPath: string): Promise<CompatibilityReview[]> {
    const mods = (await scanMods(deadlockPath)).filter((mod) => mod.enabled);
    const trees = await parseVpkDirectoriesAsync(mods.map((mod) => mod.path));
    const animations = new Set([...trees].filter(([, entries]) => (entries === null || entries.some((path) => /\.(?:vnmskel|vnmclip|vnmgraph|vanmgrph|vanim|vagrp)_c$/i.test(path)))).map(([path]) => path));
    const output: CompatibilityReview[] = [];
    for (const overrides of [false, true]) {
        const targets = mods.filter((mod) => [...animations].some((path) => path !== mod.path) === overrides);
        for (let i = 0; i < targets.length; i += 40) {
            const batch = targets.slice(i, i + 40);
            const results = compatibilityBatchSchema.parse(JSON.parse(await runVpkmergeStdout([
                'compatibility', 'check', '--base', join(getCitadelPath(deadlockPath), 'pak01_dir.vpk'),
                '--json', ...(overrides ? ['--animation-overrides'] : []), ...batch.map((mod) => mod.path),
            ])));
            for (const mod of batch) {
                const result = results.find((entry) => entry.mod === mod.path);
                if (!result) throw new Error('The repair check returned an incomplete report.');
                output.push('reports' in result
                    ? { kind: 'checked', modId: mod.id, findings: result.reports }
                    : { kind: 'failed', modId: mod.id, error: result.error });
            }
        }
    }
    return output;
}
