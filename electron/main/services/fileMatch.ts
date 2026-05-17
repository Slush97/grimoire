import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';

export interface FileFingerprint {
    path: string;
    size: number;
    sha256: string;
}

export type FileContentComparison =
    | {
        matches: true;
        left: FileFingerprint;
        right: FileFingerprint;
    }
    | {
        matches: false;
        reason: 'size';
        left: Pick<FileFingerprint, 'path' | 'size'>;
        right: Pick<FileFingerprint, 'path' | 'size'>;
    }
    | {
        matches: false;
        reason: 'sha256';
        left: FileFingerprint;
        right: FileFingerprint;
    };

export async function fingerprintFile(path: string): Promise<FileFingerprint> {
    const stats = await fs.stat(path);
    const hash = createHash('sha256');

    await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(path);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', resolve);
    });

    return {
        path,
        size: stats.size,
        sha256: hash.digest('hex'),
    };
}

export async function compareFileContents(leftPath: string, rightPath: string): Promise<FileContentComparison> {
    const [leftStats, rightStats] = await Promise.all([
        fs.stat(leftPath),
        fs.stat(rightPath),
    ]);

    if (leftStats.size !== rightStats.size) {
        return {
            matches: false,
            reason: 'size',
            left: { path: leftPath, size: leftStats.size },
            right: { path: rightPath, size: rightStats.size },
        };
    }

    const [left, right] = await Promise.all([
        fingerprintFile(leftPath),
        fingerprintFile(rightPath),
    ]);

    if (left.sha256 !== right.sha256) {
        return { matches: false, reason: 'sha256', left, right };
    }

    return { matches: true, left, right };
}
