import { existsSync, mkdirSync, readdirSync, copyFileSync, unlinkSync, writeFileSync, readFileSync, rmdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { randomBytes } from 'crypto';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import { createExtractorFromData } from 'node-unrar-js';
import { path7za as bundled7zaPath } from '7zip-bin';

/**
 * Resolve a node_modules binary path to its asar.unpacked location when packaged.
 * electron-builder rewrites __dirname inside the asar, so bundled binaries
 * (which must be executable on disk) live at app.asar.unpacked instead.
 */
function resolveUnpackedPath(p: string): string {
    return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/**
 * Find 7z executable paths, preferring the bundled binary over system installs.
 */
function find7zPath(): string[] {
    const candidates: string[] = [];

    // 1. Bundled 7za (ships with the app, no user install required)
    const bundled = resolveUnpackedPath(bundled7zaPath);
    if (existsSync(bundled)) {
        candidates.push(bundled);
    }

    // 2. Common Windows install paths (faster for huge archives)
    const windowsPaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ];
    for (const p of windowsPaths) {
        if (existsSync(p)) {
            candidates.push(p);
        }
    }

    // 3. PATH fallback
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
 * Check the archive for the GameBanana 1-Click opt-out markers.
 * Mod authors can disable mod-manager integration by including an empty
 * `.disable_gb1click` (all managers) or `.disable_gb1click_grimoire` (just us)
 * file anywhere in the archive — see https://gamebanana.com/wikis/1999.
 */
export async function checkOneClickOptOut(
    archivePath: string
): Promise<{ disabled: boolean; reason?: string }> {
    let entries: string[];
    try {
        entries = await listArchiveContents(archivePath);
    } catch {
        // If we can't list, let extraction handle the error path.
        return { disabled: false };
    }

    for (const entry of entries) {
        const name = basename(entry).toLowerCase();
        if (name === '.disable_gb1click_grimoire') {
            return { disabled: true, reason: 'The mod author disabled Grimoire 1-Click for this mod.' };
        }
        if (name === '.disable_gb1click') {
            return { disabled: true, reason: 'The mod author disabled all 1-Click installers for this mod.' };
        }
    }
    return { disabled: false };
}

/**
 * Scan an archive's listing for files with extensions that are unusual for a
 * Deadlock mod (executables, scripts, installers). Deadlock mods are pure VPK
 * content packs — there's no legitimate reason to ship a .exe or .dll. The
 * extract pipeline already filters by extension so these files can't reach
 * the game folder, but per the GameBanana 1-Click spec we still surface them
 * to the user before installing.
 */
const SUSPICIOUS_EXTENSIONS = new Set([
    '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.scr',
    '.ps1', '.psm1', '.vbs', '.js', '.jar', '.lnk', '.reg', '.hta', '.wsf',
]);

export async function scanSuspiciousFiles(archivePath: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await listArchiveContents(archivePath);
    } catch {
        return [];
    }

    const flagged: string[] = [];
    for (const entry of entries) {
        const ext = extname(entry).toLowerCase();
        if (SUSPICIOUS_EXTENSIONS.has(ext)) {
            flagged.push(entry);
        }
    }
    return flagged;
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
 * Extract a 7z archive using the bundled 7za binary (falls back to system 7z).
 */
async function extract7z(archivePath: string, destDir: string): Promise<string[]> {
    const tempDir = createTempDir('modmanager-7z');

    try {
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
            "Failed to extract 7z archive. The bundled extractor failed and no system 7-Zip was found. Please install 7-Zip from https://7-zip.org and try again."
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
 * Extract a RAR archive. Uses node-unrar-js (pure JS, no external binary) by
 * default; falls back to the bundled 7za or system unrar if the in-process
 * extractor fails (e.g. RAR5-specific features it can't handle).
 */
async function extractRar(archivePath: string, destDir: string): Promise<string[]> {
    // Primary path: pure-JS in-process RAR extractor (no install required).
    try {
        const data = readFileSync(archivePath);
        // Create an ArrayBuffer copy (node-unrar-js expects ArrayBuffer, not Buffer)
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const extractor = await createExtractorFromData({ data: ab });

        const extracted = extractor.extract({
            files: (header) => !header.flags.directory && extname(header.name).toLowerCase() === '.vpk',
        });

        const extractedVpks: string[] = [];
        for (const file of extracted.files) {
            if (!file.extraction) continue;
            const fileName = basename(file.fileHeader.name);
            const destPath = join(destDir, fileName);
            writeFileSync(destPath, Buffer.from(file.extraction));
            extractedVpks.push(destPath);
        }

        if (extractedVpks.length > 0) {
            return extractedVpks;
        }
        // No VPKs found via in-process — fall through to 7za/unrar in case of
        // odd RAR5 solid archives that node-unrar-js can't iterate.
    } catch (err) {
        console.warn('[extractRar] node-unrar-js failed, falling back to system tools:', err);
    }

    // Fallback path: bundled 7za, system 7z, or system unrar.
    const tempDir = createTempDir('modmanager-rar');
    try {
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
            "RAR extraction failed. The bundled extractor could not read this archive. Please install 7-Zip from https://7-zip.org and try again."
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
