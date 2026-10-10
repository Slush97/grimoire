import { open } from 'fs/promises';

export interface CrashEvidence {
    pid?: number;
    createdAt: number;
    entry: string;
    error: string;
}

const MAX_COMMENT_BYTES = 1024 * 1024;
const MAX_STREAMS = 256;

export function crashResourcePath(value: string): string | null {
    let path = value.replace(/\\/g, '/').toLowerCase();
    path = path.replace(/^file:\/\/\{resources\}\//, 'panorama/').replace(/^s2r:\/\//, '');
    if (!/^(panorama\/layout|scripts)\/[a-z0-9_./-]+$/.test(path) || path.split('/').includes('..')) return null;
    if (path.endsWith('.xml')) path = path.slice(0, -4) + '.vxml_c';
    if (path.endsWith('.vdata')) path += '_c';
    return /\.(vxml_c|vdata_c)$/.test(path) ? path : null;
}

/** Only explicit fatal messages qualify. Nearby warnings alone never name a mod. */
export function fatalResourceError(comments: string): Pick<CrashEvidence, 'entry' | 'error'> | null {
    const lines = comments.replace(/\0/g, '').split(/\r?\n/);
    for (const line of lines) {
        const fatal = line.indexOf('FATAL ERROR:');
        if (fatal === -1) continue;
        const message = line.slice(fatal).slice(0, 1200);
        for (const quote of message.matchAll(/['"]([^'"\r\n]+)['"]/g)) {
            const entry = crashResourcePath(quote[1]);
            if (!entry) continue;
            const parsing = lines.find(candidate => /Parsing error/i.test(candidate) &&
                [...candidate.matchAll(/(?:panorama[\\/]layout[\\/][\w./\\-]+\.xml)/g)]
                    .some(match => crashResourcePath(match[0]) === entry));
            return { entry, error: [message, parsing?.trim().slice(0, 600)].filter(Boolean).join('\n') };
        }
    }
    return null;
}

type ReadRange = (offset: number, length: number) => Promise<Buffer>;

/** Reads only the header, directory and bounded diagnostic streams, never dump memory. */
export async function decodeCrashDump(read: ReadRange, size: number): Promise<CrashEvidence | null> {
    const range = async (offset: number, length: number): Promise<Buffer> => {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) {
            throw new Error('Invalid minidump range');
        }
        const bytes = await read(offset, length);
        if (bytes.length !== length) throw new Error('Incomplete minidump');
        return bytes;
    };
    const header = await range(0, 32);
    if (header.toString('ascii', 0, 4) !== 'MDMP') return null;
    const count = header.readUInt32LE(8);
    if (count > MAX_STREAMS) return null;
    const directory = await range(header.readUInt32LE(12), count * 12);
    const createdAt = header.readUInt32LE(20) * 1000;
    let pid: number | undefined;
    const comments: string[] = [];
    for (let index = 0; index < count; index++) {
        const offset = index * 12;
        const kind = directory.readUInt32LE(offset);
        const length = directory.readUInt32LE(offset + 4);
        const address = directory.readUInt32LE(offset + 8);
        if (kind === 15 && length >= 12) {
            const misc = await range(address, 12);
            if (misc.readUInt32LE(4) & 1) pid = misc.readUInt32LE(8);
        }
        if ((kind === 10 || kind === 11) && length <= MAX_COMMENT_BYTES) {
            comments.push((await range(address, length)).toString(kind === 11 ? 'utf16le' : 'utf8'));
        }
    }
    const fatal = fatalResourceError(comments.join('\n'));
    return fatal ? { pid, createdAt, ...fatal } : null;
}

export async function readCrashDump(path: string): Promise<CrashEvidence | null> {
    const file = await open(path, 'r');
    try {
        const size = (await file.stat()).size;
        return await decodeCrashDump(async (position, length) => {
            const bytes = Buffer.alloc(length);
            const { bytesRead } = await file.read(bytes, 0, length, position);
            return bytes.subarray(0, bytesRead);
        }, size);
    } finally { await file.close(); }
}

export interface SteamGameSession {
    pid: number;
    startedAt: number;
    endedAt?: number;
}

export function steamGameSessions(log: string): SteamGameSession[] {
    const sessions: SteamGameSession[] = [];
    for (const line of log.split(/\r?\n/)) {
        const stamp = line.match(/^\[([\d-]+) ([\d:]+)\]/);
        if (!stamp || !line.includes('AppID 1422450 ')) continue;
        const time = new Date(`${stamp[1]}T${stamp[2]}`).getTime();
        if (!Number.isFinite(time)) continue;
        const start = line.match(/adding PID (\d+) as a tracked process.*[\\/]deadlock\.exe"/i);
        if (start) sessions.push({ pid: Number(start[1]), startedAt: time });
        const end = line.match(/no longer tracking PID (\d+), exit code (-?\d+)/);
        if (end) {
            const session = sessions.findLast(candidate => candidate.pid === Number(end[1]) && candidate.endedAt === undefined);
            if (session) session.endedAt = time;
        }
    }
    return sessions;
}

export function sessionForCrash(evidence: CrashEvidence, sessions: SteamGameSession[]): SteamGameSession | undefined {
    return sessions.findLast(session => session.pid === evidence.pid && session.startedAt <= evidence.createdAt + 2000 &&
        (session.endedAt === undefined || session.endedAt >= evidence.createdAt - 2000));
}
