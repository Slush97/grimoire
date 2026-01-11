import { existsSync, mkdirSync, readdirSync, copyFileSync, unlinkSync } from 'fs';
import { join, extname, basename } from 'path';
import { randomBytes } from 'crypto';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';

/**
 * Find 7z executable path on Windows, checking common installation paths
 */
function find7zPath(): string[] {
    const candidates: string[] = [];

    // Check common Windows installation paths first
    const windowsPaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ];

    for (const p of windowsPaths) {
        if (existsSync(p)) {
            candidates.push(p);
        }
    }

    // Also try PATH-based commands as fallback
    candidates.push('7z', '7za');

    return candidates;
}

/**
 * Check if a file is an archive that needs extraction
 */
export function isArchive(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return ext === '.zip' || ext === '.7z' || ext === '.rar';
}

/**
 * Extract an archive to a destination directory
 * Returns the list of extracted VPK files
 */
export async function extractArchive(
    archivePath: string,
    destDir: string
): Promise<string[]> {
    const ext = extname(archivePath).toLowerCase();

    switch (ext) {
        case '.zip':
            return extractZip(archivePath, destDir);
        case '.7z':
            return extract7z(archivePath, destDir);
        case '.rar':
            return extractRar(archivePath, destDir);
        default:
            throw new Error(`Unknown archive format: ${ext}`);
    }
}

/**
 * Extract a ZIP archive
 */
function extractZip(archivePath: string, destDir: string): string[] {
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    const extractedVpks: string[] = [];

    for (const entry of entries) {
        if (entry.isDirectory) continue;

        const fileName = basename(entry.entryName);
        const ext = extname(fileName).toLowerCase();

        // Only extract VPK files
        if (ext !== '.vpk') continue;

        // Flatten to dest directory
        const destPath = join(destDir, fileName);
        zip.extractEntryTo(entry, destDir, false, true);
        extractedVpks.push(destPath);
    }

    return extractedVpks;
}

/**
 * Extract a 7z archive using system 7z command
 */
async function extract7z(archivePath: string, destDir: string): Promise<string[]> {
    // Create temp directory for extraction
    const tempDir = createTempDir('modmanager-7z');

    try {
        // Try common 7z paths (Windows install dirs + PATH fallback)
        for (const tool of find7zPath()) {
            try {
                await runCommand(tool, ['x', '-y', `-o${tempDir}`, archivePath]);
                const vpks = collectVpks(tempDir);
                const copied = copyVpksToDest(vpks, destDir);
                return copied;
            } catch {
                // Try next tool
            }
        }

        throw new Error(
            "Failed to extract 7z. Install '7z' (p7zip-full) or '7za' and try again."
        );
    } finally {
        // Cleanup temp directory
        try {
            rmDirRecursive(tempDir);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Extract a RAR archive using system unrar or 7z command
 */
async function extractRar(archivePath: string, destDir: string): Promise<string[]> {
    const tempDir = createTempDir('modmanager-rar');

    try {
        // Try common 7z paths, then unrar as fallback
        for (const tool of [...find7zPath(), 'unrar']) {
            try {
                if (tool === 'unrar') {
                    await runCommand(tool, ['x', '-y', archivePath, tempDir]);
                } else {
                    await runCommand(tool, ['x', '-y', `-o${tempDir}`, archivePath]);
                }
                const vpks = collectVpks(tempDir);
                const copied = copyVpksToDest(vpks, destDir);
                return copied;
            } catch {
                // Try next tool
            }
        }

        throw new Error(
            "RAR extraction failed. Install '7z' or 'unrar' and try again."
        );
    } finally {
        try {
            rmDirRecursive(tempDir);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Run a command and wait for it to complete
 * Includes timeout to prevent indefinite hangs (P1 fix #6)
 */
function runCommand(cmd: string, args: string[], timeoutMs = 300000): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: 'pipe' });
        let stderr = '';
        let killed = false;

        // Set timeout to prevent indefinite hangs (5 minutes default)
        const timeoutId = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            // Force kill after 5 seconds if still running
            setTimeout(() => {
                if (!proc.killed) {
                    proc.kill('SIGKILL');
                }
            }, 5000);
            reject(new Error(`${cmd} timed out after ${timeoutMs / 1000} seconds`));
        }, timeoutMs);

        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (killed) return; // Already rejected by timeout
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${cmd} failed with code ${code}: ${stderr}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            if (killed) return;
            reject(new Error(`${cmd} failed to run: ${err.message}`));
        });
    });
}

/**
 * Recursively collect VPK files from a directory
 */
function collectVpks(dir: string): string[] {
    const vpks: string[] = [];

    function walk(currentDir: string): void {
        if (!existsSync(currentDir)) return;

        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (extname(entry.name).toLowerCase() === '.vpk') {
                vpks.push(fullPath);
            }
        }
    }

    walk(dir);
    return vpks;
}

/**
 * Copy VPK files to destination directory (flattening structure)
 */
function copyVpksToDest(vpks: string[], destDir: string): string[] {
    const copied: string[] = [];

    for (const vpk of vpks) {
        const fileName = basename(vpk);
        const destPath = join(destDir, fileName);
        copyFileSync(vpk, destPath);
        copied.push(destPath);
    }

    return copied;
}

/**
 * Create a temporary directory with cryptographically secure random name
 * (P0 security fix #3 - prevents race condition attacks)
 */
function createTempDir(prefix: string): string {
    const randomSuffix = randomBytes(16).toString('hex');
    const tmpDir = join(
        process.env.TMPDIR || process.env.TMP || '/tmp',
        `${prefix}-${randomSuffix}`
    );
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 }); // Restrict permissions
    return tmpDir;
}

/**
 * Recursively remove a directory
 */
function rmDirRecursive(dir: string): void {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            rmDirRecursive(fullPath);
        } else {
            unlinkSync(fullPath);
        }
    }

    // Remove the directory itself
    const { rmdirSync } = require('fs');
    rmdirSync(dir);
}

/**
 * List contents of an archive (for Mina variants)
 */
export async function listArchiveContents(archivePath: string): Promise<string[]> {
    const ext = extname(archivePath).toLowerCase();

    if (ext === '.zip') {
        const zip = new AdmZip(archivePath);
        return zip.getEntries().map((e) => e.entryName);
    }

    // For 7z/rar, use 7z to list - try all candidates
    const candidates = find7zPath();

    const tryCandidate = (index: number): Promise<string[]> => {
        if (index >= candidates.length) {
            return Promise.reject(new Error('Failed to list archive contents. Install 7-Zip and try again.'));
        }

        return new Promise((resolve, reject) => {
            const proc = spawn(candidates[index], ['l', '-ba', archivePath], { stdio: 'pipe' });
            let stdout = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    // Parse 7z output - extract filenames
                    const lines = stdout.split('\n').filter((l) => l.trim());
                    const files = lines
                        .map((line) => {
                            // 7z -ba output format: date time attr size compressed name
                            const parts = line.trim().split(/\s+/);
                            return parts.slice(5).join(' ');
                        })
                        .filter((f) => f);
                    resolve(files);
                } else {
                    // Try next candidate
                    tryCandidate(index + 1).then(resolve).catch(reject);
                }
            });

            proc.on('error', () => {
                // Try next candidate
                tryCandidate(index + 1).then(resolve).catch(reject);
            });
        });
    };

    return tryCandidate(0);
}
