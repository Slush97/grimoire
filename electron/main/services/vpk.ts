import { openSync, readSync, closeSync, existsSync } from 'fs';
import { join, basename } from 'path';

/**
 * VPK Header Structure (Version 2):
 * - Signature: 4 bytes (0x55AA1234)
 * - Version: 4 bytes
 * - TreeSize: 4 bytes (size of directory tree in bytes)
 * 
 * After header comes the directory tree which contains:
 * - Extension strings (null-terminated)
 * - Path strings (null-terminated)
 * - Filename strings (null-terminated)
 * 
 * We parse this to extract all file paths the VPK contains.
 */

const VPK_SIGNATURE = 0x55AA1234;

interface VpkDirectoryEntry {
    extension: string;
    path: string;
    filename: string;
    fullPath: string;
}

/**
 * Read a null-terminated string from a buffer at the given offset
 */
function readNullTerminatedString(buffer: Buffer, offset: number): { str: string; bytesRead: number } {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
        end++;
    }
    const str = buffer.slice(offset, end).toString('utf-8');
    return { str, bytesRead: end - offset + 1 }; // +1 for null terminator
}

/**
 * Parse VPK directory tree to extract all file paths
 * Returns null if the file is not a valid VPK or can't be parsed
 */
export function parseVpkDirectory(vpkPath: string): string[] | null {
    if (!existsSync(vpkPath)) {
        return null;
    }

    try {
        const fd = openSync(vpkPath, 'r');

        // Read header (12 bytes for version 2)
        const headerBuffer = Buffer.alloc(12);
        readSync(fd, headerBuffer, 0, 12, 0);

        const signature = headerBuffer.readUInt32LE(0);
        if (signature !== VPK_SIGNATURE) {
            closeSync(fd);
            return null;
        }

        const version = headerBuffer.readUInt32LE(4);
        const treeSize = headerBuffer.readUInt32LE(8);

        // Read the directory tree
        const treeBuffer = Buffer.alloc(treeSize);
        readSync(fd, treeBuffer, 0, treeSize, 12);
        closeSync(fd);

        const paths: string[] = [];
        let offset = 0;

        // Parse directory tree
        // Structure: extension\0 (path\0 (filename\0 entry_data)*)* until empty extension
        while (offset < treeBuffer.length) {
            // Read extension
            const extResult = readNullTerminatedString(treeBuffer, offset);
            offset += extResult.bytesRead;

            if (extResult.str === '' || extResult.str === ' ') {
                break; // End of extensions
            }

            const extension = extResult.str;

            // Read paths for this extension
            while (offset < treeBuffer.length) {
                const pathResult = readNullTerminatedString(treeBuffer, offset);
                offset += pathResult.bytesRead;

                if (pathResult.str === '' || pathResult.str === ' ') {
                    break; // End of paths for this extension
                }

                const dirPath = pathResult.str === ' ' ? '' : pathResult.str;

                // Read filenames for this path
                while (offset < treeBuffer.length) {
                    const nameResult = readNullTerminatedString(treeBuffer, offset);
                    offset += nameResult.bytesRead;

                    if (nameResult.str === '' || nameResult.str === ' ') {
                        break; // End of filenames for this path
                    }

                    const filename = nameResult.str;

                    // Build full path
                    const fullPath = dirPath
                        ? `${dirPath}/${filename}.${extension}`
                        : `${filename}.${extension}`;

                    paths.push(fullPath);

                    // Skip the entry data (18 bytes for version 2)
                    // CRC (4) + PreloadBytes (2) + ArchiveIndex (2) + EntryOffset (4) + EntryLength (4) + Terminator (2)
                    offset += 18;

                    // Skip preload data if any
                    if (offset - 2 < treeBuffer.length) {
                        const preloadBytes = treeBuffer.readUInt16LE(offset - 16);
                        offset += preloadBytes;
                    }
                }
            }
        }

        return paths;
    } catch (error) {
        console.error(`[parseVpkDirectory] Error parsing ${vpkPath}:`, error);
        return null;
    }
}

/**
 * Extract hero name from a VPK file path if it's a hero-related file
 * Returns null if not a hero file
 */
export function extractHeroFromPath(filePath: string): string | null {
    // Common hero path patterns in Source 2 games
    const patterns = [
        /models\/heroes\/([^\/]+)\//i,
        /materials\/models\/heroes\/([^\/]+)\//i,
        /particles\/heroes\/([^\/]+)\//i,
        /sounds\/heroes\/([^\/]+)\//i,
        /scripts\/heroes\/([^\/]+)/i,
    ];

    for (const pattern of patterns) {
        const match = filePath.match(pattern);
        if (match) {
            return match[1].toLowerCase();
        }
    }

    return null;
}

/**
 * Get a summary of what a VPK modifies
 */
export function getVpkContentSummary(vpkPath: string): {
    heroes: Set<string>;
    fileCount: number;
    samplePaths: string[];
} {
    const paths = parseVpkDirectory(vpkPath);

    if (!paths) {
        return { heroes: new Set(), fileCount: 0, samplePaths: [] };
    }

    const heroes = new Set<string>();

    for (const path of paths) {
        const hero = extractHeroFromPath(path);
        if (hero) {
            heroes.add(hero);
        }
    }

    return {
        heroes,
        fileCount: paths.length,
        samplePaths: paths.slice(0, 5), // First 5 paths as sample
    };
}
