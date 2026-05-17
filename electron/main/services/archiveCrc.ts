import { createReadStream } from 'fs';
import { validateDownloadUrl } from './security';

export interface ArchiveVpkCrcEntry {
    name: string;
    crc32: string;
    compressedSize: number;
    uncompressedSize: number;
}

export interface ArchiveVpkCrcResult {
    archiveType: 'zip' | 'rar' | '7z' | 'unknown';
    entries: ArchiveVpkCrcEntry[];
    bytesFetched: number;
    unsupportedReason?: string;
}

export interface ArchiveVpkCrcOptions {
    signal?: AbortSignal;
}

const ZIP_EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_CENTRAL_FILE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const RAR4_MARKER = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const RAR5_MARKER = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
const SEVEN_Z_SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
const RAR_FILE_BLOCK = 0x74;
const RAR_END_BLOCK = 0x7b;
const RAR_LONG_BLOCK = 0x8000;
const RAR5_BLOCK_FILE = 2;
const RAR5_BLOCK_ENCRYPTION = 4;
const RAR5_BLOCK_END = 5;
const RAR5_HAS_EXTRA = 0x0001;
const RAR5_HAS_DATA = 0x0002;
const RAR5_FILE_DIRECTORY = 0x0001;
const RAR5_FILE_UNIX_TIME = 0x0002;
const RAR5_FILE_CRC32 = 0x0004;
const DEFAULT_ZIP_TAIL_BYTES = 65_536;
const MAX_ZIP_TAIL_BYTES = 4 * 1024 * 1024;
const RAR_HEADER_BYTES = 4096;
const SEVEN_Z_START_HEADER_BYTES = 32;
const MAX_7Z_HEADER_BYTES = 8 * 1024 * 1024;
const SEVEN_Z = {
    END: 0x00,
    HEADER: 0x01,
    ARCHIVE_PROPERTIES: 0x02,
    ADDITIONAL_STREAMS_INFO: 0x03,
    MAIN_STREAMS_INFO: 0x04,
    FILES_INFO: 0x05,
    PACK_INFO: 0x06,
    UNPACK_INFO: 0x07,
    SUB_STREAMS_INFO: 0x08,
    SIZE: 0x09,
    CRC: 0x0a,
    FOLDER: 0x0b,
    CODERS_UNPACK_SIZE: 0x0c,
    NUM_UNPACK_STREAM: 0x0d,
    EMPTY_STREAM: 0x0e,
    EMPTY_FILE: 0x0f,
    NAME: 0x11,
    ENCODED_HEADER: 0x17,
} as const;
const SEVEN_Z_LZMA = '030101';
const SEVEN_Z_LZMA2 = '21';
const LZMA_NUM_STATES = 12;
const LZMA_NUM_POS_SLOT_BITS = 6;
const LZMA_NUM_LEN_TO_POS_STATES = 4;
const LZMA_MATCH_MIN_LEN = 2;
const LZMA_NUM_ALIGN_BITS = 4;
const LZMA_ALIGN_TABLE_SIZE = 1 << LZMA_NUM_ALIGN_BITS;
const LZMA_END_POS_MODEL_INDEX = 14;
const LZMA_NUM_FULL_DISTANCES = 1 << (LZMA_END_POS_MODEL_INDEX / 2);
const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < table.length; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
})();

class NeedMoreArchiveBytes extends Error { }

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error('Unknown mod search cancelled');
    }
}

function archiveTypeForName(fileName: string): ArchiveVpkCrcResult['archiveType'] {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.rar')) return 'rar';
    if (lower.endsWith('.7z')) return '7z';
    return 'unknown';
}

function isVpkArchiveEntry(name: string): boolean {
    const normalized = name.replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith('.vpk') && !normalized.endsWith('/');
}

function readU16(buffer: Buffer, offset: number): number {
    return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
    return buffer.readUInt32LE(offset);
}

export async function crc32File(filePath: string): Promise<string> {
    let crc = 0xffffffff;
    const stream = createReadStream(filePath);

    for await (const chunk of stream) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        for (const byte of buffer) {
            crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
        }
    }

    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function decodeArchiveName(raw: Buffer): string {
    const utf8 = raw.toString('utf8').replace(/\0+$/g, '');
    if (!utf8.includes('\uFFFD')) return utf8;
    return raw.toString('latin1').replace(/\0+$/g, '');
}

async function fetchArchiveRange(
    url: string,
    start: number,
    end: number,
    signal?: AbortSignal
): Promise<Buffer> {
    if (end < start) {
        throw new Error(`Invalid archive byte range ${start}-${end}`);
    }

    throwIfAborted(signal);
    validateDownloadUrl(url);

    const expected = end - start + 1;
    const response = await fetch(url, {
        headers: {
            Range: `bytes=${start}-${end}`,
            'User-Agent': 'DeadlockModManager/1.0',
        },
        redirect: 'follow',
        signal,
    });
    throwIfAborted(signal);

    if (!response.ok && response.status !== 206) {
        throw new Error(`Archive range request failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (response.status === 200 && buffer.length > expected) {
        throw new Error(`Archive server ignored range request (${buffer.length} bytes for ${expected} requested)`);
    }

    return buffer;
}

function parseZipCentralDirectory(tail: Buffer, totalSize: number): ArchiveVpkCrcEntry[] {
    const eocd = tail.lastIndexOf(ZIP_EOCD);
    if (eocd < 0 || eocd + 22 > tail.length) {
        throw new NeedMoreArchiveBytes('ZIP end-of-central-directory was not found in fetched tail');
    }

    const entryCount = readU16(tail, eocd + 10);
    const centralSize = readU32(tail, eocd + 12);
    const centralOffset = readU32(tail, eocd + 16);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error('ZIP64 central directories are not supported for CRC probing yet');
    }

    const tailStart = totalSize - tail.length;
    const centralStart = centralOffset - tailStart;
    if (centralStart < 0 || centralStart + centralSize > tail.length) {
        throw new NeedMoreArchiveBytes('ZIP central directory is not fully in fetched tail');
    }

    const entries: ArchiveVpkCrcEntry[] = [];
    let pos = centralStart;
    for (let index = 0; index < entryCount; index++) {
        if (pos + 46 > tail.length || !tail.subarray(pos, pos + 4).equals(ZIP_CENTRAL_FILE)) {
            throw new Error(`ZIP central directory entry ${index} has an unexpected signature`);
        }

        const crc32 = readU32(tail, pos + 16);
        const compressedSize = readU32(tail, pos + 20);
        const uncompressedSize = readU32(tail, pos + 24);
        const nameLen = readU16(tail, pos + 28);
        const extraLen = readU16(tail, pos + 30);
        const commentLen = readU16(tail, pos + 32);
        const nameStart = pos + 46;
        const nameEnd = nameStart + nameLen;
        const name = decodeArchiveName(tail.subarray(nameStart, nameEnd)).replace(/\\/g, '/');

        if (isVpkArchiveEntry(name)) {
            entries.push({
                name,
                crc32: crc32.toString(16).padStart(8, '0'),
                compressedSize,
                uncompressedSize,
            });
        }

        pos = nameEnd + extraLen + commentLen;
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchZipVpkCrcEntries(
    downloadUrl: string,
    fileSize: number,
    signal?: AbortSignal
): Promise<ArchiveVpkCrcResult> {
    let bytesToFetch = Math.min(DEFAULT_ZIP_TAIL_BYTES, fileSize);
    let bytesFetched = 0;

    while (bytesToFetch <= Math.min(MAX_ZIP_TAIL_BYTES, fileSize)) {
        throwIfAborted(signal);
        const start = Math.max(0, fileSize - bytesToFetch);
        const tail = await fetchArchiveRange(downloadUrl, start, fileSize - 1, signal);
        bytesFetched += tail.length;

        try {
            return {
                archiveType: 'zip',
                entries: parseZipCentralDirectory(tail, fileSize),
                bytesFetched,
            };
        } catch (err) {
            if (!(err instanceof NeedMoreArchiveBytes) || bytesToFetch >= Math.min(MAX_ZIP_TAIL_BYTES, fileSize)) {
                throw err;
            }
            bytesToFetch = Math.min(bytesToFetch * 2, MAX_ZIP_TAIL_BYTES, fileSize);
        }
    }

    return { archiveType: 'zip', entries: [], bytesFetched };
}

function readU64LE(buffer: Buffer, offset: number): number {
    const value = buffer.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('7z header offset is too large to represent safely');
    }
    return Number(value);
}

class SevenZReader {
    private offset = 0;

    constructor(private readonly buffer: Buffer) { }

    get position(): number {
        return this.offset;
    }

    get remaining(): number {
        return this.buffer.length - this.offset;
    }

    readByte(): number {
        if (this.offset >= this.buffer.length) throw new NeedMoreArchiveBytes('7z metadata is truncated');
        return this.buffer[this.offset++];
    }

    readBytes(length: number): Buffer {
        if (length < 0 || this.offset + length > this.buffer.length) {
            throw new NeedMoreArchiveBytes('7z metadata property is truncated');
        }
        const value = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
    }

    readUInt32(): number {
        if (this.offset + 4 > this.buffer.length) throw new NeedMoreArchiveBytes('7z CRC is truncated');
        const value = readU32(this.buffer, this.offset);
        this.offset += 4;
        return value;
    }

    readNumber(): number {
        const first = this.readByte();
        let mask = 0x80;
        let value = 0;

        for (let i = 0; i < 8; i++) {
            if ((first & mask) === 0) {
                value += (first & (mask - 1)) * 2 ** (8 * i);
                return value;
            }
            value += this.readByte() * 2 ** (8 * i);
            mask >>= 1;
        }

        return value;
    }

    skip(length: number): void {
        this.readBytes(length);
    }
}

interface SevenZOptionalCrc {
    defined: boolean;
    crc32?: number;
}

interface SevenZCoder {
    methodId: string;
    properties: Buffer;
    inStreams: number;
    outStreams: number;
}

interface SevenZFolder {
    coders: SevenZCoder[];
    unpackSizes: number[];
    crc?: SevenZOptionalCrc;
}

interface SevenZPackInfo {
    packPos: number;
    sizes: number[];
}

interface SevenZStreamInfo {
    packInfo?: SevenZPackInfo;
    folders: SevenZFolder[];
    unpackStreams: Array<{ size: number; crc?: SevenZOptionalCrc }>;
}

function readSevenZBitVector(reader: SevenZReader, count: number): boolean[] {
    const bits: boolean[] = [];
    let mask = 0;
    let byte = 0;

    for (let i = 0; i < count; i++) {
        if (mask === 0) {
            byte = reader.readByte();
            mask = 0x80;
        }
        bits.push((byte & mask) !== 0);
        mask >>= 1;
    }

    return bits;
}

function readSevenZDefinedVector(reader: SevenZReader, count: number): boolean[] {
    const allDefined = reader.readByte() !== 0;
    return allDefined ? Array(count).fill(true) : readSevenZBitVector(reader, count);
}

function readSevenZCrcs(reader: SevenZReader, count: number): SevenZOptionalCrc[] {
    const defined = readSevenZDefinedVector(reader, count);
    return defined.map((isDefined) => ({
        defined: isDefined,
        crc32: isDefined ? reader.readUInt32() : undefined,
    }));
}

function skipSevenZUnknownProperty(reader: SevenZReader, propertyName: string): never {
    throw new Error(`Unsupported 7z metadata property in ${propertyName}`);
}

function parseSevenZPackInfo(reader: SevenZReader): SevenZPackInfo {
    const packPos = reader.readNumber();
    const numPackStreams = reader.readNumber();
    const sizes: number[] = [];

    while (true) {
        const id = reader.readByte();
        if (id === SEVEN_Z.END) break;
        if (id === SEVEN_Z.SIZE) {
            for (let i = 0; i < numPackStreams; i++) {
                sizes.push(reader.readNumber());
            }
            continue;
        }
        if (id === SEVEN_Z.CRC) {
            readSevenZCrcs(reader, numPackStreams);
            continue;
        }
        skipSevenZUnknownProperty(reader, 'PackInfo');
    }

    return { packPos, sizes };
}

function parseSevenZFolder(reader: SevenZReader): SevenZFolder {
    const numCoders = reader.readNumber();
    const coders: SevenZCoder[] = [];
    let totalInStreams = 0;
    let totalOutStreams = 0;

    for (let i = 0; i < numCoders; i++) {
        const mainByte = reader.readByte();
        const methodIdSize = mainByte & 0x0f;
        const isComplex = (mainByte & 0x10) !== 0;
        const hasAttributes = (mainByte & 0x20) !== 0;
        const hasAlternativeMethods = (mainByte & 0x80) !== 0;
        if (hasAlternativeMethods) throw new Error('7z folders with alternative methods are not supported');

        let inStreams = 1;
        let outStreams = 1;
        if (isComplex) {
            inStreams = reader.readNumber();
            outStreams = reader.readNumber();
        }

        const methodId = reader.readBytes(methodIdSize).toString('hex');
        const properties = hasAttributes ? reader.readBytes(reader.readNumber()) : Buffer.alloc(0);
        coders.push({ methodId, properties, inStreams, outStreams });
        totalInStreams += inStreams;
        totalOutStreams += outStreams;
    }

    const bindPairs = Math.max(0, totalOutStreams - 1);
    for (let i = 0; i < bindPairs; i++) {
        reader.readNumber();
        reader.readNumber();
    }

    const packedStreams = totalInStreams - bindPairs;
    for (let i = 0; i < Math.max(0, packedStreams - 1); i++) {
        reader.readNumber();
    }

    return { coders, unpackSizes: [] };
}

function parseSevenZUnpackInfo(reader: SevenZReader): SevenZFolder[] {
    if (reader.readByte() !== SEVEN_Z.FOLDER) throw new Error('7z UnpackInfo is missing Folder data');
    const numFolders = reader.readNumber();
    const external = reader.readByte();
    if (external !== 0) throw new Error('7z external folder metadata is not supported');

    const folders: SevenZFolder[] = [];
    for (let i = 0; i < numFolders; i++) {
        folders.push(parseSevenZFolder(reader));
    }

    if (reader.readByte() !== SEVEN_Z.CODERS_UNPACK_SIZE) {
        throw new Error('7z UnpackInfo is missing coder unpack sizes');
    }
    for (const folder of folders) {
        const outStreams = folder.coders.reduce((sum, coder) => sum + coder.outStreams, 0);
        folder.unpackSizes = [];
        for (let i = 0; i < outStreams; i++) {
            folder.unpackSizes.push(reader.readNumber());
        }
    }

    const next = reader.readByte();
    if (next === SEVEN_Z.CRC) {
        const crcs = readSevenZCrcs(reader, folders.length);
        folders.forEach((folder, index) => { folder.crc = crcs[index]; });
        if (reader.readByte() !== SEVEN_Z.END) throw new Error('7z UnpackInfo has unexpected data after CRCs');
    } else if (next !== SEVEN_Z.END) {
        skipSevenZUnknownProperty(reader, 'UnpackInfo');
    }

    return folders;
}

function folderUnpackSize(folder: SevenZFolder): number {
    return folder.unpackSizes[folder.unpackSizes.length - 1] ?? 0;
}

function defaultSevenZSubStreams(folders: SevenZFolder[]): Array<{ size: number; crc?: SevenZOptionalCrc }> {
    return folders.map((folder) => ({ size: folderUnpackSize(folder), crc: folder.crc }));
}

function parseSevenZSubStreamsInfo(
    reader: SevenZReader,
    folders: SevenZFolder[]
): Array<{ size: number; crc?: SevenZOptionalCrc }> {
    let numUnpackStreams = Array(folders.length).fill(1) as number[];
    let unpackSizes: number[] | null = null;
    let streamCrcs: Array<SevenZOptionalCrc | undefined> | null = null;

    while (true) {
        const id = reader.readByte();
        if (id === SEVEN_Z.END) break;

        if (id === SEVEN_Z.NUM_UNPACK_STREAM) {
            numUnpackStreams = folders.map(() => reader.readNumber());
            continue;
        }

        if (id === SEVEN_Z.SIZE) {
            unpackSizes = [];
            for (let folderIndex = 0; folderIndex < folders.length; folderIndex++) {
                const count = numUnpackStreams[folderIndex];
                let sum = 0;
                for (let streamIndex = 1; streamIndex < count; streamIndex++) {
                    const size = reader.readNumber();
                    unpackSizes.push(size);
                    sum += size;
                }
                if (count > 0) {
                    unpackSizes.push(folderUnpackSize(folders[folderIndex]) - sum);
                }
            }
            continue;
        }

        if (id === SEVEN_Z.CRC) {
            const digestCount = folders.reduce((sum, folder, index) => {
                const count = numUnpackStreams[index];
                return sum + (count === 1 && folder.crc?.defined ? 0 : count);
            }, 0);
            const digests = readSevenZCrcs(reader, digestCount);
            streamCrcs = [];
            let digestIndex = 0;
            for (let folderIndex = 0; folderIndex < folders.length; folderIndex++) {
                const count = numUnpackStreams[folderIndex];
                const folder = folders[folderIndex];
                if (count === 1 && folder.crc?.defined) {
                    streamCrcs.push(folder.crc);
                } else {
                    for (let streamIndex = 0; streamIndex < count; streamIndex++) {
                        streamCrcs.push(digests[digestIndex++]);
                    }
                }
            }
            continue;
        }

        skipSevenZUnknownProperty(reader, 'SubStreamsInfo');
    }

    if (!unpackSizes) {
        unpackSizes = [];
        for (let folderIndex = 0; folderIndex < folders.length; folderIndex++) {
            const count = numUnpackStreams[folderIndex];
            if (count === 0) continue;
            if (count !== 1) throw new Error('7z substream sizes are missing');
            unpackSizes.push(folderUnpackSize(folders[folderIndex]));
        }
    }

    if (!streamCrcs) {
        streamCrcs = [];
        for (let folderIndex = 0; folderIndex < folders.length; folderIndex++) {
            const count = numUnpackStreams[folderIndex];
            const folder = folders[folderIndex];
            for (let streamIndex = 0; streamIndex < count; streamIndex++) {
                streamCrcs.push(count === 1 ? folder.crc : undefined);
            }
        }
    }

    return unpackSizes.map((size, index) => ({ size, crc: streamCrcs[index] }));
}

function parseSevenZStreamsInfo(reader: SevenZReader): SevenZStreamInfo {
    let packInfo: SevenZPackInfo | undefined;
    let folders: SevenZFolder[] = [];
    let unpackStreams: Array<{ size: number; crc?: SevenZOptionalCrc }> = [];

    while (true) {
        const id = reader.readByte();
        if (id === SEVEN_Z.END) break;
        if (id === SEVEN_Z.PACK_INFO) {
            packInfo = parseSevenZPackInfo(reader);
        } else if (id === SEVEN_Z.UNPACK_INFO) {
            folders = parseSevenZUnpackInfo(reader);
            unpackStreams = defaultSevenZSubStreams(folders);
        } else if (id === SEVEN_Z.SUB_STREAMS_INFO) {
            unpackStreams = parseSevenZSubStreamsInfo(reader, folders);
        } else {
            skipSevenZUnknownProperty(reader, 'StreamsInfo');
        }
    }

    return { packInfo, folders, unpackStreams };
}

function parseSevenZNames(raw: Buffer, numFiles: number): string[] {
    const names: string[] = [];
    let start = 0;
    for (let pos = 0; pos + 1 < raw.length && names.length < numFiles; pos += 2) {
        if (raw[pos] === 0 && raw[pos + 1] === 0) {
            names.push(raw.subarray(start, pos).toString('utf16le').replace(/\\/g, '/'));
            start = pos + 2;
        }
    }
    return names;
}

function parseSevenZFilesInfo(
    reader: SevenZReader,
    streams: Array<{ size: number; crc?: SevenZOptionalCrc }>
): ArchiveVpkCrcEntry[] {
    const numFiles = reader.readNumber();
    let names = Array.from({ length: numFiles }, (_, index) => `file-${index}`);
    let emptyStreams: boolean[] = Array(numFiles).fill(false);

    while (true) {
        const id = reader.readByte();
        if (id === SEVEN_Z.END) break;

        const size = reader.readNumber();
        const propertyEnd = reader.position + size;
        if (id === SEVEN_Z.NAME) {
            const external = reader.readByte();
            if (external !== 0) throw new Error('7z external filename metadata is not supported');
            names = parseSevenZNames(reader.readBytes(size - 1), numFiles);
        } else if (id === SEVEN_Z.EMPTY_STREAM) {
            emptyStreams = readSevenZBitVector(reader, numFiles);
        } else if (id === SEVEN_Z.EMPTY_FILE) {
            reader.skip(size);
        } else {
            reader.skip(size);
        }

        if (reader.position !== propertyEnd) {
            if (reader.position > propertyEnd) throw new Error('7z file property parser over-read');
            reader.skip(propertyEnd - reader.position);
        }
    }

    const entries: ArchiveVpkCrcEntry[] = [];
    let streamIndex = 0;
    for (let fileIndex = 0; fileIndex < numFiles; fileIndex++) {
        if (emptyStreams[fileIndex]) continue;

        const stream = streams[streamIndex++];
        const name = names[fileIndex] ?? `file-${fileIndex}`;
        if (!stream || !isVpkArchiveEntry(name) || !stream.crc?.defined || stream.crc.crc32 === undefined) {
            continue;
        }

        entries.push({
            name,
            crc32: stream.crc.crc32.toString(16).padStart(8, '0'),
            compressedSize: 0,
            uncompressedSize: stream.size,
        });
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

class LzmaRangeDecoder {
    private range = 0xffffffff;
    private code = 0;
    private offset = 0;

    constructor(private readonly input: Buffer) {
        for (let i = 0; i < 5; i++) {
            this.code = (this.code * 256 + this.readByte()) >>> 0;
        }
    }

    private readByte(): number {
        return this.offset < this.input.length ? this.input[this.offset++] : 0;
    }

    private normalize(): void {
        if (this.range < 0x01000000) {
            this.range = (this.range * 256) >>> 0;
            this.code = (this.code * 256 + this.readByte()) >>> 0;
        }
    }

    decodeBit(probs: Uint16Array, index: number): number {
        const prob = probs[index];
        const bound = (this.range >>> 11) * prob;
        if (this.code < bound) {
            this.range = bound >>> 0;
            probs[index] = prob + ((2048 - prob) >> 5);
            this.normalize();
            return 0;
        }

        this.range = (this.range - bound) >>> 0;
        this.code = (this.code - bound) >>> 0;
        probs[index] = prob - (prob >> 5);
        this.normalize();
        return 1;
    }

    decodeDirectBits(count: number): number {
        let result = 0;
        for (let i = 0; i < count; i++) {
            this.range >>>= 1;
            let bit = 0;
            if (this.code >= this.range) {
                this.code = (this.code - this.range) >>> 0;
                bit = 1;
            }
            this.normalize();
            result = (result << 1) | bit;
        }
        return result;
    }
}

function filledLzmaProbs(size: number): Uint16Array {
    const probs = new Uint16Array(size);
    probs.fill(1024);
    return probs;
}

function decodeLzmaBitTree(decoder: LzmaRangeDecoder, probs: Uint16Array, start: number, bits: number): number {
    let symbol = 1;
    for (let i = 0; i < bits; i++) {
        symbol = (symbol << 1) | decoder.decodeBit(probs, start + symbol);
    }
    return symbol - (1 << bits);
}

function decodeLzmaReverseBitTree(decoder: LzmaRangeDecoder, probs: Uint16Array, start: number, bits: number): number {
    let symbol = 1;
    let result = 0;
    for (let i = 0; i < bits; i++) {
        const bit = decoder.decodeBit(probs, start + symbol);
        symbol = (symbol << 1) | bit;
        result |= bit << i;
    }
    return result;
}

class LzmaLengthDecoder {
    private readonly choice = filledLzmaProbs(2);
    private readonly low: Uint16Array[];
    private readonly mid: Uint16Array[];
    private readonly high = filledLzmaProbs(1 << 8);

    constructor(posStates: number) {
        this.low = Array.from({ length: posStates }, () => filledLzmaProbs(1 << 3));
        this.mid = Array.from({ length: posStates }, () => filledLzmaProbs(1 << 3));
    }

    decode(decoder: LzmaRangeDecoder, posState: number): number {
        if (decoder.decodeBit(this.choice, 0) === 0) {
            return decodeLzmaBitTree(decoder, this.low[posState], 0, 3);
        }
        if (decoder.decodeBit(this.choice, 1) === 0) {
            return 8 + decodeLzmaBitTree(decoder, this.mid[posState], 0, 3);
        }
        return 16 + decodeLzmaBitTree(decoder, this.high, 0, 8);
    }
}

function updateLzmaStateChar(state: number): number {
    if (state < 4) return 0;
    if (state < 10) return state - 3;
    return state - 6;
}

function decodeLzmaRaw(properties: Buffer, input: Buffer, expectedSize: number): Buffer {
    if (properties.length < 5) throw new Error('LZMA properties are missing');
    const prop = properties[0];
    const lc = prop % 9;
    const remainder = Math.floor(prop / 9);
    const lp = remainder % 5;
    const pb = Math.floor(remainder / 5);
    if (pb > 4) throw new Error('Unsupported LZMA pb value');

    const posStateCount = 1 << pb;
    const posStateMask = posStateCount - 1;
    const literalContexts = 1 << (lc + lp);
    const literalProbs = Array.from({ length: literalContexts }, () => filledLzmaProbs(0x300));
    const isMatch = filledLzmaProbs(LZMA_NUM_STATES * posStateCount);
    const isRep = filledLzmaProbs(LZMA_NUM_STATES);
    const isRepG0 = filledLzmaProbs(LZMA_NUM_STATES);
    const isRepG1 = filledLzmaProbs(LZMA_NUM_STATES);
    const isRepG2 = filledLzmaProbs(LZMA_NUM_STATES);
    const isRep0Long = filledLzmaProbs(LZMA_NUM_STATES * posStateCount);
    const posSlot = Array.from({ length: LZMA_NUM_LEN_TO_POS_STATES }, () => filledLzmaProbs(1 << LZMA_NUM_POS_SLOT_BITS));
    const posDecoders = filledLzmaProbs(LZMA_NUM_FULL_DISTANCES - LZMA_END_POS_MODEL_INDEX);
    const posAlign = filledLzmaProbs(LZMA_ALIGN_TABLE_SIZE);
    const lenDecoder = new LzmaLengthDecoder(posStateCount);
    const repLenDecoder = new LzmaLengthDecoder(posStateCount);
    const decoder = new LzmaRangeDecoder(input);
    const output = Buffer.alloc(expectedSize);
    const reps = [0, 0, 0, 0];
    let state = 0;
    let outPos = 0;

    while (outPos < expectedSize) {
        const posState = outPos & posStateMask;
        if (decoder.decodeBit(isMatch, state * posStateCount + posState) === 0) {
            const prevByte = outPos === 0 ? 0 : output[outPos - 1];
            const literalState = ((outPos & ((1 << lp) - 1)) << lc) + (prevByte >> (8 - lc));
            const probs = literalProbs[literalState];
            let symbol = 1;

            if (state < 7) {
                while (symbol < 0x100) {
                    symbol = (symbol << 1) | decoder.decodeBit(probs, symbol);
                }
            } else {
                const matchByte = reps[0] < outPos ? output[outPos - reps[0] - 1] : 0;
                for (let bitIndex = 7; bitIndex >= 0; bitIndex--) {
                    const matchBit = (matchByte >> bitIndex) & 1;
                    const bit = decoder.decodeBit(probs, ((1 + matchBit) << 8) + symbol);
                    symbol = (symbol << 1) | bit;
                    if (matchBit !== bit) {
                        while (symbol < 0x100) {
                            symbol = (symbol << 1) | decoder.decodeBit(probs, symbol);
                        }
                        break;
                    }
                }
            }

            output[outPos++] = symbol - 0x100;
            state = updateLzmaStateChar(state);
            continue;
        }

        let len: number;
        if (decoder.decodeBit(isRep, state) === 1) {
            if (decoder.decodeBit(isRepG0, state) === 0) {
                if (decoder.decodeBit(isRep0Long, state * posStateCount + posState) === 0) {
                    if (reps[0] >= outPos) throw new Error('Invalid LZMA short repeat distance');
                    output[outPos] = output[outPos - reps[0] - 1];
                    outPos++;
                    state = state < 7 ? 9 : 11;
                    continue;
                }
            } else {
                let distance: number;
                if (decoder.decodeBit(isRepG1, state) === 0) {
                    distance = reps[1];
                } else {
                    if (decoder.decodeBit(isRepG2, state) === 0) {
                        distance = reps[2];
                    } else {
                        distance = reps[3];
                        reps[3] = reps[2];
                    }
                    reps[2] = reps[1];
                }
                reps[1] = reps[0];
                reps[0] = distance;
            }
            len = repLenDecoder.decode(decoder, posState) + LZMA_MATCH_MIN_LEN;
            state = state < 7 ? 8 : 11;
        } else {
            reps[3] = reps[2];
            reps[2] = reps[1];
            reps[1] = reps[0];
            len = lenDecoder.decode(decoder, posState) + LZMA_MATCH_MIN_LEN;
            state = state < 7 ? 7 : 10;

            const lenToPosState = Math.min(len - LZMA_MATCH_MIN_LEN, LZMA_NUM_LEN_TO_POS_STATES - 1);
            const slot = decodeLzmaBitTree(decoder, posSlot[lenToPosState], 0, LZMA_NUM_POS_SLOT_BITS);
            if (slot < 4) {
                reps[0] = slot;
            } else {
                const directBits = (slot >> 1) - 1;
                reps[0] = (2 | (slot & 1)) << directBits;
                if (slot < LZMA_END_POS_MODEL_INDEX) {
                    reps[0] += decodeLzmaReverseBitTree(decoder, posDecoders, reps[0] - slot - 1, directBits);
                } else {
                    reps[0] += decoder.decodeDirectBits(directBits - LZMA_NUM_ALIGN_BITS) << LZMA_NUM_ALIGN_BITS;
                    reps[0] += decodeLzmaReverseBitTree(decoder, posAlign, 0, LZMA_NUM_ALIGN_BITS);
                }
            }
        }

        if (reps[0] >= outPos) throw new Error('Invalid LZMA match distance');
        for (let i = 0; i < len && outPos < expectedSize; i++) {
            output[outPos] = output[outPos - reps[0] - 1];
            outPos++;
        }
    }

    return output;
}

function lzma2DictionarySize(prop: number): number {
    if (prop > 40) throw new Error('Invalid LZMA2 dictionary property');
    if (prop === 40) return 0xffffffff;
    return (2 | (prop & 1)) << (Math.floor(prop / 2) + 11);
}

function buildLzmaProps(prop0: number, dictionarySize: number): Buffer {
    const props = Buffer.alloc(5);
    props[0] = prop0;
    props.writeUInt32LE(dictionarySize >>> 0, 1);
    return props;
}

function decodeLzma2(properties: Buffer, input: Buffer, expectedSize: number): Buffer {
    if (properties.length < 1) throw new Error('LZMA2 properties are missing');
    const dictionarySize = lzma2DictionarySize(properties[0]);
    const chunks: Buffer[] = [];
    let produced = 0;
    let pos = 0;
    let lzmaProps: Buffer | null = null;

    while (pos < input.length && produced < expectedSize) {
        const control = input[pos++];
        if (control === 0) break;

        if (control === 1 || control === 2) {
            if (pos + 2 > input.length) throw new NeedMoreArchiveBytes('LZMA2 uncompressed chunk is truncated');
            const size = ((input[pos] << 8) | input[pos + 1]) + 1;
            pos += 2;
            if (pos + size > input.length) throw new NeedMoreArchiveBytes('LZMA2 uncompressed data is truncated');
            chunks.push(input.subarray(pos, pos + size));
            pos += size;
            produced += size;
            continue;
        }

        if (control < 0x80) throw new Error('Unsupported LZMA2 chunk control byte');
        if (pos + 4 > input.length) throw new NeedMoreArchiveBytes('LZMA2 compressed chunk header is truncated');
        const unpackSize = (((control & 0x1f) << 16) | (input[pos] << 8) | input[pos + 1]) + 1;
        pos += 2;
        const packSize = ((input[pos] << 8) | input[pos + 1]) + 1;
        pos += 2;

        if (control >= 0xc0) {
            if (pos >= input.length) throw new NeedMoreArchiveBytes('LZMA2 properties are truncated');
            lzmaProps = buildLzmaProps(input[pos++], dictionarySize);
        }
        if (!lzmaProps) throw new Error('LZMA2 chunk is missing decoder properties');
        if (pos + packSize > input.length) throw new NeedMoreArchiveBytes('LZMA2 compressed data is truncated');

        const decoded = decodeLzmaRaw(lzmaProps, input.subarray(pos, pos + packSize), unpackSize);
        chunks.push(decoded);
        pos += packSize;
        produced += decoded.length;
    }

    return Buffer.concat(chunks, produced).subarray(0, expectedSize);
}

function decodeSevenZFolder(folder: SevenZFolder, packed: Buffer): Buffer {
    if (folder.coders.length !== 1) throw new Error('7z encoded headers with filter chains are not supported');
    const coder = folder.coders[0];
    const unpackSize = folderUnpackSize(folder);

    if (coder.methodId === SEVEN_Z_LZMA) {
        return decodeLzmaRaw(coder.properties, packed, unpackSize);
    }
    if (coder.methodId === SEVEN_Z_LZMA2) {
        return decodeLzma2(coder.properties, packed, unpackSize);
    }

    throw new Error(`Unsupported 7z encoded header method ${coder.methodId}`);
}

function parseSevenZHeaderEntries(header: Buffer): ArchiveVpkCrcEntry[] {
    const reader = new SevenZReader(header);
    const root = reader.readByte();
    if (root !== SEVEN_Z.HEADER) throw new Error('7z decoded metadata did not contain a file header');

    let streams: SevenZStreamInfo = { folders: [], unpackStreams: [] };
    while (reader.remaining > 0) {
        const id = reader.readByte();
        if (id === SEVEN_Z.END) break;
        if (id === SEVEN_Z.ARCHIVE_PROPERTIES) {
            while (reader.readByte() !== SEVEN_Z.END) {
                reader.skip(reader.readNumber());
            }
        } else if (id === SEVEN_Z.ADDITIONAL_STREAMS_INFO || id === SEVEN_Z.MAIN_STREAMS_INFO) {
            streams = parseSevenZStreamsInfo(reader);
        } else if (id === SEVEN_Z.FILES_INFO) {
            return parseSevenZFilesInfo(reader, streams.unpackStreams);
        } else {
            skipSevenZUnknownProperty(reader, 'Header');
        }
    }

    return [];
}

async function fetch7zVpkCrcEntries(
    downloadUrl: string,
    fileSize: number,
    signal?: AbortSignal
): Promise<ArchiveVpkCrcResult> {
    const startHeader = await fetchArchiveRange(downloadUrl, 0, Math.min(SEVEN_Z_START_HEADER_BYTES - 1, fileSize - 1), signal);
    let bytesFetched = startHeader.length;
    if (!startHeader.subarray(0, SEVEN_Z_SIGNATURE.length).equals(SEVEN_Z_SIGNATURE)) {
        throw new Error('7z signature was not found');
    }
    if (startHeader.length < SEVEN_Z_START_HEADER_BYTES) {
        throw new NeedMoreArchiveBytes('7z start header is truncated');
    }

    const nextHeaderOffset = readU64LE(startHeader, 12);
    const nextHeaderSize = readU64LE(startHeader, 20);
    if (nextHeaderSize > MAX_7Z_HEADER_BYTES) {
        return {
            archiveType: '7z',
            entries: [],
            bytesFetched,
            unsupportedReason: `7z metadata header is too large (${nextHeaderSize.toLocaleString()} bytes)`,
        };
    }

    const headerStart = SEVEN_Z_START_HEADER_BYTES + nextHeaderOffset;
    const header = await fetchArchiveRange(downloadUrl, headerStart, headerStart + nextHeaderSize - 1, signal);
    bytesFetched += header.length;

    try {
        const reader = new SevenZReader(header);
        const root = reader.readByte();
        if (root === SEVEN_Z.HEADER) {
            return {
                archiveType: '7z',
                entries: parseSevenZHeaderEntries(header),
                bytesFetched,
            };
        }
        if (root !== SEVEN_Z.ENCODED_HEADER) {
            throw new Error('7z metadata has an unexpected root marker');
        }

        const encodedStreams = parseSevenZStreamsInfo(reader);
        if (!encodedStreams.packInfo || encodedStreams.packInfo.sizes.length !== 1 || encodedStreams.folders.length !== 1) {
            throw new Error('7z encoded header layout is not supported');
        }

        const packedStart = SEVEN_Z_START_HEADER_BYTES + encodedStreams.packInfo.packPos;
        const packedSize = encodedStreams.packInfo.sizes[0];
        const packed = await fetchArchiveRange(downloadUrl, packedStart, packedStart + packedSize - 1, signal);
        bytesFetched += packed.length;
        const decodedHeader = decodeSevenZFolder(encodedStreams.folders[0], packed);

        return {
            archiveType: '7z',
            entries: parseSevenZHeaderEntries(decodedHeader),
            bytesFetched,
        };
    } catch (err) {
        throwIfAborted(signal);
        return {
            archiveType: '7z',
            entries: [],
            bytesFetched,
            unsupportedReason: err instanceof Error ? err.message : String(err),
        };
    }
}

function readVint(buffer: Buffer, offset: number): { value: number; offset: number } {
    let value = 0;
    let shift = 0;
    let pos = offset;

    for (let i = 0; i < 10; i++) {
        if (pos >= buffer.length) throw new NeedMoreArchiveBytes('RAR variable integer is truncated');
        const byte = buffer[pos++];
        value += (byte & 0x7f) * 2 ** shift;
        if (byte < 0x80) return { value, offset: pos };
        shift += 7;
    }

    throw new Error('RAR variable integer is too large');
}

function parseRar4FileHeader(block: Buffer): { packedSize: number; entry?: ArchiveVpkCrcEntry } {
    if (block.length < 32) throw new NeedMoreArchiveBytes('RAR4 file header is truncated');

    const flags = readU16(block, 3);
    const headerSize = readU16(block, 5);
    let packedSize = readU32(block, 7);
    let unpackedSize = readU32(block, 11);
    const crc32 = readU32(block, 16);
    const nameSize = readU16(block, 26);
    let nameOffset = 32;

    if (flags & 0x0100) {
        if (block.length < 40) throw new NeedMoreArchiveBytes('RAR4 high-size fields are truncated');
        packedSize += readU32(block, 32) * 2 ** 32;
        unpackedSize += readU32(block, 36) * 2 ** 32;
        nameOffset = 40;
    }

    const nameEnd = nameOffset + nameSize;
    if (nameEnd > Math.min(block.length, headerSize)) {
        throw new NeedMoreArchiveBytes('RAR4 file name is truncated');
    }

    const name = decodeArchiveName(block.subarray(nameOffset, nameEnd)).replace(/\\/g, '/');
    return {
        packedSize,
        entry: isVpkArchiveEntry(name)
            ? {
                name,
                crc32: crc32.toString(16).padStart(8, '0'),
                compressedSize: packedSize,
                uncompressedSize: unpackedSize,
            }
            : undefined,
    };
}

function parseRar5FileHeader(headerData: Buffer, pos: number, dataSize: number): ArchiveVpkCrcEntry | undefined {
    const fileFlags = readVint(headerData, pos);
    pos = fileFlags.offset;
    const unpackedSize = readVint(headerData, pos);
    pos = unpackedSize.offset;
    const attributes = readVint(headerData, pos);
    pos = attributes.offset;

    if (fileFlags.value & RAR5_FILE_UNIX_TIME) {
        if (pos + 4 > headerData.length) throw new NeedMoreArchiveBytes('RAR5 mtime is truncated');
        pos += 4;
    }

    let crc32 = '';
    if (fileFlags.value & RAR5_FILE_CRC32) {
        if (pos + 4 > headerData.length) throw new NeedMoreArchiveBytes('RAR5 CRC32 is truncated');
        crc32 = readU32(headerData, pos).toString(16).padStart(8, '0');
        pos += 4;
    }

    pos = readVint(headerData, pos).offset; // compression info
    pos = readVint(headerData, pos).offset; // host OS
    const nameSize = readVint(headerData, pos);
    pos = nameSize.offset;

    const nameEnd = pos + nameSize.value;
    if (nameEnd > headerData.length) throw new NeedMoreArchiveBytes('RAR5 file name is truncated');
    const name = decodeArchiveName(headerData.subarray(pos, nameEnd)).replace(/\\/g, '/');

    if ((fileFlags.value & RAR5_FILE_DIRECTORY) || !isVpkArchiveEntry(name)) {
        return undefined;
    }

    return {
        name,
        crc32,
        compressedSize: dataSize,
        uncompressedSize: unpackedSize.value,
    };
}

function parseRar5BlockHeader(block: Buffer): {
    headerType: number;
    dataSize: number;
    headerDataEnd: number;
    nextOffsetDelta: number;
    fileHeaderStart: number;
} {
    if (block.length < 8) throw new NeedMoreArchiveBytes('RAR5 block header is truncated');

    let pos = 4;
    const headerSize = readVint(block, pos);
    pos = headerSize.offset;
    const headerDataStart = pos;
    const headerDataEnd = headerDataStart + headerSize.value;
    if (headerDataEnd > block.length) {
        throw new NeedMoreArchiveBytes('RAR5 full block header is not in the fetched range');
    }

    const headerType = readVint(block, pos);
    pos = headerType.offset;
    const headerFlags = readVint(block, pos);
    pos = headerFlags.offset;

    if (headerFlags.value & RAR5_HAS_EXTRA) {
        pos = readVint(block, pos).offset;
    }

    let dataSize = 0;
    if (headerFlags.value & RAR5_HAS_DATA) {
        const parsed = readVint(block, pos);
        dataSize = parsed.value;
        pos = parsed.offset;
    }

    return {
        headerType: headerType.value,
        dataSize,
        headerDataEnd,
        nextOffsetDelta: headerDataEnd + dataSize,
        fileHeaderStart: pos,
    };
}

async function fetchRar5VpkCrcEntries(
    downloadUrl: string,
    fileSize: number,
    signal?: AbortSignal
): Promise<ArchiveVpkCrcResult> {
    const marker = await fetchArchiveRange(downloadUrl, 0, Math.min(RAR5_MARKER.length - 1, fileSize - 1), signal);
    let bytesFetched = marker.length;
    if (!marker.subarray(0, RAR5_MARKER.length).equals(RAR5_MARKER)) {
        throw new Error('RAR5 marker was not found');
    }

    const entries: ArchiveVpkCrcEntry[] = [];
    let offset = RAR5_MARKER.length;
    let blocksSeen = 0;

    while (offset < fileSize && blocksSeen < 10_000) {
        throwIfAborted(signal);
        blocksSeen++;
        const previewEnd = Math.min(fileSize - 1, offset + RAR_HEADER_BYTES - 1);
        let block = await fetchArchiveRange(downloadUrl, offset, previewEnd, signal);
        bytesFetched += block.length;

        let header;
        try {
            header = parseRar5BlockHeader(block);
        } catch (err) {
            if (!(err instanceof NeedMoreArchiveBytes) || block.length < 7) throw err;
            const sizeProbe = readVint(block, 4);
            const fullHeaderSize = sizeProbe.offset + sizeProbe.value;
            block = await fetchArchiveRange(downloadUrl, offset, offset + fullHeaderSize - 1, signal);
            bytesFetched += block.length;
            header = parseRar5BlockHeader(block);
        }

        if (header.headerType === RAR5_BLOCK_ENCRYPTION) {
            return {
                archiveType: 'rar',
                entries,
                bytesFetched,
                unsupportedReason: 'RAR5 archive headers are encrypted',
            };
        }
        if (header.headerType === RAR5_BLOCK_FILE) {
            const entry = parseRar5FileHeader(block.subarray(0, header.headerDataEnd), header.fileHeaderStart, header.dataSize);
            if (entry) entries.push(entry);
        }

        offset += header.nextOffsetDelta;
        if (header.headerType === RAR5_BLOCK_END) break;
    }

    return {
        archiveType: 'rar',
        entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
        bytesFetched,
    };
}

async function fetchRar4VpkCrcEntries(
    downloadUrl: string,
    fileSize: number,
    signal?: AbortSignal
): Promise<ArchiveVpkCrcResult> {
    const marker = await fetchArchiveRange(downloadUrl, 0, Math.min(RAR5_MARKER.length - 1, fileSize - 1), signal);
    let bytesFetched = marker.length;
    if (marker.subarray(0, RAR5_MARKER.length).equals(RAR5_MARKER)) {
        const result = await fetchRar5VpkCrcEntries(downloadUrl, fileSize, signal);
        return result;
    }
    if (!marker.subarray(0, RAR4_MARKER.length).equals(RAR4_MARKER)) {
        throw new Error('RAR marker was not found');
    }

    const entries: ArchiveVpkCrcEntry[] = [];
    let offset = RAR4_MARKER.length;
    let blocksSeen = 0;

    while (offset < fileSize && blocksSeen < 10_000) {
        throwIfAborted(signal);
        blocksSeen++;
        const previewEnd = Math.min(fileSize - 1, offset + RAR_HEADER_BYTES - 1);
        let block = await fetchArchiveRange(downloadUrl, offset, previewEnd, signal);
        bytesFetched += block.length;

        if (block.length < 7) break;
        const blockType = block[2];
        const flags = readU16(block, 3);
        const headerSize = readU16(block, 5);
        if (headerSize < 7) throw new Error(`Invalid RAR4 block header size at offset ${offset}: ${headerSize}`);
        if (headerSize > block.length) {
            block = await fetchArchiveRange(downloadUrl, offset, offset + headerSize - 1, signal);
            bytesFetched += block.length;
        }

        let dataSize = 0;
        if (blockType === RAR_FILE_BLOCK) {
            const parsed = parseRar4FileHeader(block);
            dataSize = parsed.packedSize;
            if (parsed.entry) entries.push(parsed.entry);
        } else if (flags & RAR_LONG_BLOCK) {
            if (block.length < 11) throw new NeedMoreArchiveBytes('RAR4 long block size is truncated');
            dataSize = readU32(block, 7);
        }

        offset += headerSize + dataSize;
        if (blockType === RAR_END_BLOCK) break;
    }

    return {
        archiveType: 'rar',
        entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
        bytesFetched,
    };
}

export async function fetchGameBananaArchiveVpkCrcEntries(file: {
    fileName: string;
    fileSize: number;
    downloadUrl: string;
}, options: ArchiveVpkCrcOptions = {}): Promise<ArchiveVpkCrcResult> {
    const archiveType = archiveTypeForName(file.fileName);
    throwIfAborted(options.signal);

    if (archiveType === 'zip') {
        return fetchZipVpkCrcEntries(file.downloadUrl, file.fileSize, options.signal);
    }
    if (archiveType === 'rar') {
        return fetchRar4VpkCrcEntries(file.downloadUrl, file.fileSize, options.signal);
    }
    if (archiveType === '7z') {
        return fetch7zVpkCrcEntries(file.downloadUrl, file.fileSize, options.signal);
    }

    return {
        archiveType,
        entries: [],
        bytesFetched: 0,
        unsupportedReason: `Unsupported archive type for ${file.fileName}`,
    };
}

