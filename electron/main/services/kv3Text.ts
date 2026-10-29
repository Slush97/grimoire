// Parses KV3 text, as models embed their keyvalues (m_modelInfo.m_keyValueText). Typed values
// (`resource:"..."`, `resource_name:"..."`, `soundevent:"..."`) read as their string, flagged values as
// their value, and binary blobs (`#[ ... ]`) as arrays of byte values. Bounded: rejects input past the
// size or nesting limits rather than allocating for it.

import type { KVObject, KVValue } from '../../../src/lib/particles/kv';

const MAX_TEXT_LENGTH = 4 * 1024 * 1024;
const MAX_DEPTH = 64;

export function parseKv3Text(text: string): KVObject {
    if (text.length > MAX_TEXT_LENGTH) throw new Error('KV3 text exceeds limits.');
    let i = 0;

    const fail = (message: string): never => {
        throw new Error(`KV3 text: ${message} at ${i}`);
    };

    const skip = () => {
        for (;;) {
            while (i < text.length && /\s/.test(text[i])) i++;
            if (text.startsWith('//', i)) {
                const end = text.indexOf('\n', i);
                i = end < 0 ? text.length : end + 1;
            } else if (text.startsWith('/*', i)) {
                const end = text.indexOf('*/', i + 2);
                i = end < 0 ? fail('unterminated comment') : end + 2;
            } else if (text.startsWith('<!--', i)) {
                const end = text.indexOf('-->', i + 4);
                i = end < 0 ? fail('unterminated header') : end + 3;
            } else {
                return;
            }
        }
    };

    const readString = (): string => {
        if (text.startsWith('"""', i)) {
            const end = text.indexOf('"""', i + 3);
            if (end < 0) fail('unterminated multi-line string');
            let body = text.slice(i + 3, end);
            i = end + 3;
            if (body.startsWith('\r\n')) body = body.slice(2);
            else if (body.startsWith('\n')) body = body.slice(1);
            if (body.endsWith('\r\n')) body = body.slice(0, -2);
            else if (body.endsWith('\n')) body = body.slice(0, -1);
            return body;
        }
        i++;
        let out = '';
        while (i < text.length && text[i] !== '"') {
            if (text[i] === '\\' && i + 1 < text.length) {
                const next = text[i + 1];
                out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
                i += 2;
            } else {
                out += text[i++];
            }
        }
        if (i >= text.length) fail('unterminated string');
        i++;
        return out;
    };

    const readWord = (): string => {
        const start = i;
        while (i < text.length && /[A-Za-z0-9_.+\-|]/.test(text[i])) i++;
        if (i === start) fail(`unexpected ${JSON.stringify(text[i] ?? 'end')}`);
        return text.slice(start, i);
    };

    const readKey = (): string => {
        skip();
        return text[i] === '"' ? readString() : readWord();
    };

    const readValue = (depth: number): KVValue => {
        if (depth > MAX_DEPTH) fail('nesting too deep');
        skip();
        const c = text[i];
        if (c === '{') {
            i++;
            const obj: KVObject = {};
            for (;;) {
                skip();
                if (text[i] === '}') { i++; return obj; }
                if (i >= text.length) fail('unterminated object');
                const key = readKey();
                skip();
                if (text[i] !== '=') fail('expected =');
                i++;
                obj[key] = readValue(depth + 1);
                skip();
                if (text[i] === ',') i++;
            }
        }
        if (c === '[') {
            i++;
            const arr: KVValue[] = [];
            for (;;) {
                skip();
                if (text[i] === ']') { i++; return arr; }
                if (i >= text.length) fail('unterminated array');
                arr.push(readValue(depth + 1));
                skip();
                if (text[i] === ',') i++;
            }
        }
        if (c === '#' && text[i + 1] === '[') {
            i += 2;
            const bytes: number[] = [];
            for (;;) {
                skip();
                if (text[i] === ']') { i++; return bytes; }
                if (i >= text.length) fail('unterminated blob');
                bytes.push(Number.parseInt(text.slice(i, i + 2), 16));
                i += 2;
            }
        }
        if (c === '"') return readString();
        const word = readWord();
        // A typed value (resource:"...") or flagged value reads as the value after the colon
        if (text[i] === ':') {
            i++;
            return readValue(depth + 1);
        }
        if (word === 'true') return true;
        if (word === 'false') return false;
        if (word === 'null') return null;
        const number = Number(word);
        return Number.isFinite(number) ? number : word;
    };

    skip();
    const root = readValue(0);
    if (root === null || typeof root !== 'object' || Array.isArray(root)) fail('root is not an object');
    return root as KVObject;
}
