type SafetyFile = { path: string; bytes: Buffer; preload?: number; crc?: number };

/**
 * Tiny inert archives for scanner tests. Their script bytes are never executed.
 * `root` is how a root-level file's folder is spelled: a space, or the empty
 * string some packers write.
 */
export function safetyVpk(files: SafetyFile[], version = 1, root = ' '): Buffer {
    const { directory, data } = safetyArchive(files, version, 0x7fff, root);
    return Buffer.concat([directory, data]);
}

/** The same archive with every payload in `_000.vpk`, as multi-chunk releases ship. */
export function safetyChunkedVpk(files: Array<{ path: string; bytes: Buffer }>): { dir: Buffer; chunk: Buffer } {
    const { directory, data } = safetyArchive(files, 1, 0);
    return { dir: directory, chunk: data };
}

function safetyArchive(files: SafetyFile[], version: number, archive: number, root = ' ') {
    const tree: Buffer[] = [];
    const data: Buffer[] = [];
    let offset = 0;
    const groups = new Map<string, Map<string, typeof files>>();
    for (const file of files) {
        const slash = file.path.lastIndexOf('/');
        const dot = file.path.lastIndexOf('.');
        const extension = dot > slash ? file.path.slice(dot + 1) : ' ';
        const folder = slash === -1 ? root : file.path.slice(0, slash);
        if (!groups.has(extension)) groups.set(extension, new Map());
        const folders = groups.get(extension)!;
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder)!.push(file);
    }
    const str = (s: string) => tree.push(Buffer.from(s + '\0'));
    for (const [extension, folders] of groups) {
        str(extension);
        for (const [folder, entries] of folders) {
            str(folder);
            for (const file of entries) {
                const slash = file.path.lastIndexOf('/');
                const dot = file.path.lastIndexOf('.');
                str(file.path.slice(slash + 1, dot > slash ? dot : undefined));
                const preload = file.preload ?? 0;
                const meta = Buffer.alloc(18);
                meta.writeUInt32LE(file.crc ?? 0);
                meta.writeUInt16LE(preload, 4);
                meta.writeUInt16LE(archive, 6);
                meta.writeUInt32LE(offset, 8);
                meta.writeUInt32LE(file.bytes.length - preload, 12);
                meta.writeUInt16LE(0xffff, 16);
                tree.push(meta, file.bytes.subarray(0, preload));
                data.push(file.bytes.subarray(preload));
                offset += file.bytes.length - preload;
            }
            str('');
        }
        str('');
    }
    str('');
    const directory = Buffer.concat(tree);
    const header = Buffer.alloc(version === 2 ? 28 : 12);
    header.writeUInt32LE(0x55aa1234);
    header.writeUInt32LE(version, 4);
    header.writeUInt32LE(directory.length, 8);
    if (version === 2) header.writeUInt32LE(offset, 12);
    return { directory: Buffer.concat([header, directory]), data: Buffer.concat(data) };
}

export function safetyResource(data: Buffer, tag = 'DATA'): Buffer {
    return safetyResourceBlocks([[tag, data]]);
}

/** A compiled resource with several blocks, in the given order. */
export function safetyResourceBlocks(blocks: Array<[tag: string, data: Buffer]>): Buffer {
    const header = Buffer.alloc(16 + blocks.length * 12);
    let offset = header.length;
    blocks.forEach(([tag, data], i) => {
        const entry = 16 + i * 12;
        header.write(tag, entry, 4, 'ascii');
        header.writeUInt32LE(offset - (entry + 4), entry + 4);
        header.writeUInt32LE(data.length, entry + 8);
        offset += data.length;
    });
    header.writeUInt32LE(offset);
    header.writeUInt16LE(12, 4);
    header.writeUInt32LE(8, 8);
    header.writeUInt32LE(blocks.length, 12);
    return Buffer.concat([header, ...blocks.map(([, data]) => data)]);
}

/** The DATA block of a stylesheet, SVG or text layout: a CRC, an empty image-name table, then the text. */
export function safetyPanoramaText(text: string): Buffer {
    return Buffer.concat([Buffer.alloc(6), Buffer.from(text)]);
}

/** Minimal uncompressed KV3 v4 LaCo fixture: only object, array and string lanes. */
export function safetyLayout(script: string): Buffer {
    const strings: string[] = [];
    const words: number[] = [0];
    const types: number[] = [];
    const intern = (s: string) => {
        if (!strings.includes(s)) strings.push(s);
        return strings.indexOf(s);
    };
    const write = (value: unknown) => {
        if (typeof value === 'string') { types.push(6); words.push(intern(value)); }
        else if (Array.isArray(value)) {
            types.push(8); words.push(value.length); value.forEach(write);
        } else if (value && typeof value === 'object') {
            const pairs = Object.entries(value);
            types.push(9); words.push(pairs.length);
            for (const [key, child] of pairs) { words.push(intern(key)); write(child); }
        } else throw new Error('Unsupported test value');
    };
    write({ m_AST: { m_pRoot: { eType: 'ROOT', vecChildren: [{ eType: 'SCRIPT_BODY', name: script }] } } });
    words[0] = strings.length;
    const lane = Buffer.alloc(Math.ceil(words.length * 4 / 8) * 8);
    words.forEach((n, i) => lane.writeUInt32LE(n, i * 4));
    const symbols = Buffer.from(strings.join('\0') + '\0');
    const trailer = Buffer.alloc(4); trailer.writeUInt32LE(0xffeedd00);
    const body = Buffer.concat([lane, symbols, Buffer.from(types), trailer]);
    const header = Buffer.alloc(72);
    header.writeUInt32LE(0x4b563304);
    header.fill(1, 4, 20);
    header.writeUInt32LE(words.length, 32);
    header.writeUInt32LE(symbols.length + types.length, 40);
    header.writeUInt32LE(body.length, 48);
    header.writeUInt32LE(body.length, 52);
    return safetyResource(Buffer.concat([header, body]), 'LaCo');
}
