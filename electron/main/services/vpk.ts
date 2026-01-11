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

        // Read basic header first (12 bytes) to check signature and version
        const headerBuffer = Buffer.alloc(12);
        readSync(fd, headerBuffer, 0, 12, 0);

        const signature = headerBuffer.readUInt32LE(0);
        console.log(`[parseVpkDirectory] Signature: 0x${signature.toString(16)}, expected: 0x${VPK_SIGNATURE.toString(16)}`);

        if (signature !== VPK_SIGNATURE) {
            closeSync(fd);
            console.log(`[parseVpkDirectory] Invalid signature, not a VPK file`);
            return null;
        }

        const version = headerBuffer.readUInt32LE(4);
        const treeSize = headerBuffer.readUInt32LE(8);
        console.log(`[parseVpkDirectory] Version: ${version}, TreeSize: ${treeSize}`);

        // VPK v2 has an extended header (28 bytes total vs 12 for v1)
        // After the first 12 bytes, v2 has: FileDataSectionSize(4) + ArchiveMD5SectionSize(4) + OtherMD5SectionSize(4) + SignatureSectionSize(4)
        const headerSize = version === 2 ? 28 : 12;
        console.log(`[parseVpkDirectory] Using header size: ${headerSize} for version ${version}`);

        // Read the directory tree (starts after the full header)
        const treeBuffer = Buffer.alloc(treeSize);
        readSync(fd, treeBuffer, 0, treeSize, headerSize);
        closeSync(fd);

        console.log(`[parseVpkDirectory] First 100 bytes of tree:`, treeBuffer.slice(0, 100).toString('utf-8').replace(/\0/g, '|'));

        const paths: string[] = [];
        let offset = 0;

        // Parse directory tree
        // Structure: extension\0 (path\0 (filename\0 entry_data)*)* until empty extension
        while (offset < treeBuffer.length) {
            // Read extension
            const extResult = readNullTerminatedString(treeBuffer, offset);
            offset += extResult.bytesRead;

            if (extResult.str === '') {
                break; // End of extensions (empty string only)
            }

            const extension = extResult.str;

            // Read paths for this extension
            while (offset < treeBuffer.length) {
                const pathResult = readNullTerminatedString(treeBuffer, offset);
                offset += pathResult.bytesRead;

                if (pathResult.str === '') {
                    break; // End of paths for this extension (empty string only)
                }

                // Space means root directory in VPK format
                const dirPath = pathResult.str === ' ' ? '' : pathResult.str;

                // Read filenames for this path
                while (offset < treeBuffer.length) {
                    const nameResult = readNullTerminatedString(treeBuffer, offset);
                    offset += nameResult.bytesRead;

                    if (nameResult.str === '') {
                        break; // End of filenames for this path (empty string only)
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
                    // PreloadBytes is at offset 4 in the entry (after CRC), so offset - 14 after skipping 18
                    if (offset - 14 >= 0 && offset - 14 < treeBuffer.length - 1) {
                        const preloadBytes = treeBuffer.readUInt16LE(offset - 14);
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
    // Hero path patterns for Source 2 games (including Deadlock which uses heroes_wip)
    const patterns = [
        // Standard Source 2 patterns
        /models\/heroes\/([^\/]+)\//i,
        /materials\/models\/heroes\/([^\/]+)\//i,
        /particles\/heroes\/([^\/]+)\//i,
        /sounds\/heroes\/([^\/]+)\//i,
        /scripts\/heroes\/([^\/]+)/i,
        // Deadlock-specific patterns (uses heroes_wip instead of heroes)
        /models\/heroes_wip\/([^\/]+)\//i,
        /materials\/models\/heroes_wip\/([^\/]+)\//i,
        /materials\/heroes_wip\/([^\/]+)\//i,
        /particles\/heroes_wip\/([^\/]+)\//i,
        /sounds\/heroes_wip\/([^\/]+)\//i,
        /scripts\/heroes_wip\/([^\/]+)/i,
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
        console.log(`[getVpkContentSummary] Failed to parse VPK: ${vpkPath}`);
        return { heroes: new Set(), fileCount: 0, samplePaths: [] };
    }

    console.log(`[getVpkContentSummary] Parsed ${paths.length} paths from ${vpkPath}`);
    console.log(`[getVpkContentSummary] Sample paths:`, paths.slice(0, 10));

    const heroes = new Set<string>();

    for (const path of paths) {
        const hero = extractHeroFromPath(path);
        if (hero) {
            heroes.add(hero);
        }
    }

    console.log(`[getVpkContentSummary] Detected heroes: ${[...heroes].join(', ') || 'none'}`);

    return {
        heroes,
        fileCount: paths.length,
        samplePaths: paths.slice(0, 5), // First 5 paths as sample
    };
}
