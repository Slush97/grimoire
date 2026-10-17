import { createHash, randomUUID } from 'crypto';
import { constants, createReadStream, promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { getUserDataPath } from '../utils/paths';
import { loadSettings } from './settings';
import { findChunkSiblingNames } from './vpk';
import type { ModMetadata } from './metadata';
import type { ModBackupSummary } from '../../../src/types/modBackup';
import { getModBackupIdentity } from '../../../src/lib/modBackupIdentity';

export const MOD_BACKUP_RETENTION_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

interface BackupFile {
    name: string;
    size: number;
    sha256: string;
}

interface BackupManifest {
    version: 1;
    summary: ModBackupSummary;
    metadata: ModMetadata;
    files: BackupFile[];
}

// Separate from the mod mutation lock: cleanup must never remove a backup
// while another operation is reading or committing it.
let pendingOperation: Promise<unknown> = Promise.resolve();
const changeListeners = new Set<() => void>();

export function observeModBackupChanges(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => { changeListeners.delete(listener); };
}

function notifyChanges(): void {
    for (const listener of changeListeners) {
        try { listener(); } catch (error) { console.warn('[ModBackups] Change listener failed:', error); }
    }
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = pendingOperation.then(operation);
    pendingOperation = result.catch(() => {});
    return result;
}

function backupRoot(): string {
    return join(getUserDataPath(), 'mod-backups');
}

function backupPath(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new Error('Invalid mod backup ID.');
    return join(backupRoot(), id);
}

function isFileName(name: unknown): name is string {
    return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' &&
        !/[\\/:]/.test(name) && [...name].every((character) => character.charCodeAt(0) >= 32) && basename(name) === name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const data of createReadStream(path)) hash.update(data);
    return hash.digest('hex');
}

async function assertRegularFile(path: string): Promise<void> {
    if (!(await fs.lstat(path)).isFile()) throw new Error('Mod backup payload must be a regular file.');
}

async function readManifest(id: string): Promise<BackupManifest> {
    const directory = backupPath(id);
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Invalid mod backup directory.');
    const manifestPath = join(directory, 'manifest.json');
    await assertRegularFile(manifestPath);
    const value: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.summary) ||
        !isRecord(value.metadata) || !Array.isArray(value.files) || value.files.length === 0) {
        throw new Error('Invalid mod backup manifest.');
    }
    const summary = value.summary;
    if (summary.id !== id || !isFileName(summary.fileName) || !/\.vpk$/i.test(summary.fileName) ||
        typeof summary.modName !== 'string' || typeof summary.identityKey !== 'string' ||
        !Number.isSafeInteger(summary.createdAt) || (summary.createdAt as number) <= 0 ||
        summary.expiresAt !== (summary.createdAt as number) + MOD_BACKUP_RETENTION_MS ||
        (summary.displayFileName !== undefined && typeof summary.displayFileName !== 'string') ||
        (summary.description !== undefined && typeof summary.description !== 'string') ||
        (summary.sourceSection !== undefined && typeof summary.sourceSection !== 'string') ||
        (summary.localGroupId !== undefined && typeof summary.localGroupId !== 'string') ||
        (summary.gameBananaId !== undefined && !Number.isSafeInteger(summary.gameBananaId)) ||
        (summary.sha256 !== undefined && (typeof summary.sha256 !== 'string' || !HASH_PATTERN.test(summary.sha256)))) {
        throw new Error('Invalid mod backup summary.');
    }
    const names = new Set<string>();
    for (const file of value.files) {
        if (!isRecord(file) || !isFileName(file.name) || !Number.isSafeInteger(file.size) ||
            (file.size as number) < 0 || typeof file.sha256 !== 'string' || !HASH_PATTERN.test(file.sha256) ||
            names.has(file.name.toLowerCase())) throw new Error('Invalid mod backup file.');
        names.add(file.name.toLowerCase());
    }
    const manifest = value as unknown as BackupManifest;
    const allowedNames = new Set([
        manifest.summary.fileName,
        ...findChunkSiblingNames(manifest.summary.fileName, manifest.files.map((file) => file.name)),
    ]);
    if (!manifest.files.some((file) => file.name === summary.fileName) ||
        manifest.files.some((file) => !allowedNames.has(file.name))) {
        throw new Error('Invalid mod backup VPK set.');
    }
    return manifest;
}

async function removeBackup(id: string): Promise<void> {
    const path = backupPath(id);
    const exists = await fs.lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
    });
    if (!exists) return;
    await fs.rm(path, { recursive: true, force: true });
    notifyChanges();
}

/** Expiry removes files only when explicitly requested by startup cleanup. */
async function readManifests(cleanupExpired = false): Promise<BackupManifest[]> {
    let entries;
    try {
        entries = await fs.readdir(backupRoot(), { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
    const manifests: BackupManifest[] = [];
    const now = Date.now();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (cleanupExpired && entry.name.startsWith('.pending-') && UUID_PATTERN.test(entry.name.slice('.pending-'.length))) {
            const path = join(backupRoot(), entry.name);
            const stats = await fs.lstat(path);
            if (stats.isDirectory() && stats.mtimeMs + MOD_BACKUP_RETENTION_MS <= now) {
                await fs.rm(path, { recursive: true, force: true });
            }
            continue;
        }
        if (!UUID_PATTERN.test(entry.name)) continue;
        let manifest: BackupManifest;
        try {
            manifest = await readManifest(entry.name);
        } catch (error) {
            console.warn('[ModBackups] Skipping unreadable backup:', entry.name, error);
            // A corrupt manifest must not make a backup immortal.
            if (cleanupExpired && (await fs.lstat(backupPath(entry.name))).mtimeMs + MOD_BACKUP_RETENTION_MS <= now) {
                await removeBackup(entry.name);
            }
            continue;
        }
        if (cleanupExpired && manifest.summary.expiresAt <= now) await removeBackup(entry.name);
        else manifests.push(manifest);
    }
    return manifests;
}

/** Capture before removal. Failure throws so the caller can preserve the old mod. */
export function captureModBackup(
    sourcePath: string,
    metadata: ModMetadata | undefined,
    modName?: string,
): Promise<ModBackupSummary | null> {
    return serialize(async () => {
        if (!loadSettings().keepModBackups) return null;
        const fileName = basename(sourcePath);
        if (!isFileName(fileName) || !/\.vpk$/i.test(fileName)) throw new Error('Invalid backup source filename.');
        const id = randomUUID();
        const temporaryPath = join(backupRoot(), `.pending-${id}`);
        await fs.mkdir(backupRoot(), { recursive: true });
        await fs.mkdir(temporaryPath);
        try {
            const names = [fileName, ...findChunkSiblingNames(fileName, await fs.readdir(dirname(sourcePath)))];
            const files: BackupFile[] = [];
            for (const name of names) {
                const source = join(dirname(sourcePath), name);
                await assertRegularFile(source);
                const before = await fs.stat(source);
                const destination = join(temporaryPath, name);
                await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
                const after = await fs.stat(source);
                if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
                    throw new Error('Mod changed while creating its backup.');
                }
                files.push({ name, size: before.size, sha256: await hashFile(destination) });
            }
            const createdAt = Date.now();
            const summary: ModBackupSummary = {
                id,
                createdAt,
                expiresAt: createdAt + MOD_BACKUP_RETENTION_MS,
                fileName,
                displayFileName: metadata?.archiveVpkPath?.split(/[\\/]/).at(-1) || metadata?.sourceFileName || fileName,
                description: metadata?.fileDescription || metadata?.variantLabel || undefined,
                modName: metadata?.modName || modName || fileName,
                identityKey: getModBackupIdentity(metadata, fileName, modName),
                gameBananaId: metadata?.gameBananaId,
                sourceSection: metadata?.sourceSection,
                localGroupId: metadata?.localGroupId,
                sha256: metadata?.sha256?.toLowerCase(),
            };
            const manifest: BackupManifest = { version: 1, summary, metadata: metadata ?? {}, files };
            await fs.writeFile(join(temporaryPath, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
            await fs.rename(temporaryPath, backupPath(id));
            notifyChanges();
            return summary;
        } catch (error) {
            await fs.rm(temporaryPath, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    });
}

export function listModBackups(): Promise<ModBackupSummary[]> {
    return serialize(async () => (await readManifests())
        .map((manifest) => manifest.summary)
        .sort((a, b) => b.createdAt - a.createdAt));
}

export function getModBackupSummary(id: string): Promise<ModBackupSummary> {
    return serialize(async () => (await readManifest(id)).summary);
}

export function deleteModBackup(id: string): Promise<void> {
    return serialize(() => removeBackup(id));
}

/** Copy chunks first and the mountable directory last. Never overwrite a file. */
export function copyModBackupTo(
    id: string,
    destinationPath: string,
): Promise<{ metadata: ModMetadata; summary: ModBackupSummary }> {
    return serialize(async () => {
        const manifest = await readManifest(id);
        const destinationName = basename(destinationPath);
        if (!isFileName(destinationName) || !/\.vpk$/i.test(destinationName)) throw new Error('Invalid restore filename.');
        const sourceName = manifest.summary.fileName;
        const hasChunks = manifest.files.length > 1;
        if (hasChunks && !/_dir\.vpk$/i.test(destinationName)) throw new Error('Split VPKs require a directory filename.');
        const sourceStem = sourceName.slice(0, -'_dir.vpk'.length);
        const destinationStem = destinationName.slice(0, -'_dir.vpk'.length);
        await fs.mkdir(dirname(destinationPath), { recursive: true });
        const siblings = await fs.readdir(dirname(destinationPath));
        if (siblings.some((name) => name.toLowerCase() === destinationName.toLowerCase()) ||
            findChunkSiblingNames(destinationName, siblings).length > 0) {
            throw new Error('A file already occupies the backup restore destination.');
        }
        // Validate the complete set before exposing any restored file.
        for (const file of manifest.files) {
            const path = join(backupPath(id), file.name);
            await assertRegularFile(path);
            if ((await fs.stat(path)).size !== file.size || await hashFile(path) !== file.sha256) {
                throw new Error('Mod backup contents failed integrity verification.');
            }
        }
        const written: string[] = [];
        try {
            const files = [...manifest.files].sort((a, b) => Number(a.name === sourceName) - Number(b.name === sourceName));
            for (const file of files) {
                const target = file.name === sourceName ? destinationPath :
                    join(dirname(destinationPath), destinationStem + file.name.slice(sourceStem.length));
                await fs.copyFile(join(backupPath(id), file.name), target, constants.COPYFILE_EXCL);
                written.push(target);
                if (await hashFile(target) !== file.sha256) throw new Error('Restored mod failed integrity verification.');
            }
        } catch (error) {
            for (const path of written.reverse()) await fs.unlink(path).catch(() => {});
            throw error;
        }
        return { metadata: manifest.metadata, summary: manifest.summary };
    });
}

/** Run once at startup, independently of the capture preference. */
export function cleanupExpiredModBackups(): Promise<void> {
    return serialize(async () => { await readManifests(true); });
}
