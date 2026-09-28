import { parse, tokenizer, type Node } from 'acorn';
import type { ModSafetyFinding, ModSafetyReason } from '../../../src/types/modSafety';

export const MOD_SAFETY_POLICY_VERSION = 2;

interface AstNode extends Node {
    [key: string]: unknown;
}

function node(value: unknown): AstNode | undefined {
    return value !== null && typeof value === 'object' && 'type' in value
        ? value as AstNode : undefined;
}

function constant(value: unknown, bindings: Map<string, string>, depth = 0): string | undefined {
    const n = node(value);
    if (!n || depth > 24) return undefined;
    if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
    if (n.type === 'Identifier') return bindings.get(String(n.name));
    if (n.type === 'BinaryExpression' && n.operator === '+') {
        const a = constant(n.left, bindings, depth + 1);
        const b = constant(n.right, bindings, depth + 1);
        if (a !== undefined && b !== undefined && a.length + b.length <= 65536) return a + b;
    }
    if (n.type === 'TemplateLiteral' && Array.isArray(n.expressions) && !n.expressions.length
        && Array.isArray(n.quasis)) {
        const q = node(n.quasis[0]);
        const v = q?.value;
        if (v && typeof v === 'object' && 'cooked' in v && typeof v.cooked === 'string') return v.cooked;
    }
    return undefined;
}

function decodeEntities(text: string): string {
    return text.replace(/&#(x[\da-f]+|\d+);/gi, (original, code: string) => {
        const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original;
    }).replace(/&colon;/gi, ':').replace(/&sol;/gi, '/').replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'").replace(/&amp;/gi, '&');
}

function panoramaEventCalls(source: string): string {
    // Panorama also separates top-level event calls with whitespace.
    try {
        const reader = tokenizer(source, { ecmaVersion: 'latest' });
        let current = reader.getToken();
        let previous = '';
        let depth = 0;
        let start = 0;
        let offset = 0;
        let count = 0;
        const parts: string[] = [];
        while (current.type.label !== 'eof') {
            if (++count > 200000) return source;
            const next = reader.getToken();
            const label = current.type.label;
            if (depth === 0 && previous === ')' && label === 'name' && next.type.label === '(') {
                const prefix = node(parse(source.slice(start, current.start), { ecmaVersion: 'latest' }));
                const body = prefix?.body;
                if (Array.isArray(body) && body.length === 1 && node(body[0])?.type === 'ExpressionStatement'
                    && node(node(body[0])?.expression)?.type === 'CallExpression') {
                    parts.push(source.slice(offset, current.start), ';');
                    offset = start = current.start;
                }
            }
            if (['(', '[', '{'].includes(label)) depth++;
            if ([')', ']', '}'].includes(label)) depth--;
            if (depth === 0 && label === ';') start = current.end;
            previous = label;
            current = next;
        }
        return parts.join('') + source.slice(offset);
    } catch { return source; }
}

function panoramaEventSource(source: string): string {
    // Panorama accepts bare localization tokens as event arguments. Tokenize
    // first so strings, comments, regular expressions and JS private fields
    // cannot be changed by a textual replacement.
    try {
        const reader = tokenizer(source, { ecmaVersion: 'latest' });
        let previous = '';
        let current = reader.getToken();
        let offset = 0;
        let count = 0;
        const parts: string[] = [];
        while (current.type.label !== 'eof') {
            if (++count > 200000) return source;
            const next = reader.getToken();
            if (current.type.label === 'privateId' && (previous === '(' || previous === ',')
                && (next.type.label === ')' || next.type.label === ',')
                && /^#[A-Za-z_][\w]*$/.test(source.slice(current.start, current.end))) {
                parts.push(source.slice(offset, current.start), JSON.stringify(source.slice(current.start, current.end)));
                offset = current.end;
            }
            previous = current.type.label;
            current = next;
        }
        return panoramaEventCalls(parts.length ? parts.join('') + source.slice(offset) : source);
    } catch { return source; }
}

/** Findings describe risks. Every script needs consent even if none fire. */
export function inspectModSource(entry: string, source: string, javascript: boolean): ModSafetyFinding[] {
    const reasons = new Set<ModSafetyReason>();
    function inspectText(text: string): void {
        if (/(?:\bfile\s*:|\\\\[^\\\s"'<>]+\\)/i.test(text)) reasons.add('local-file');
        if (/\bjavascript\s*:|\b(?:CitadelHTMLPanel|HTMLPanel|HTMLTitle|HTMLFinishRequest|SetURL|SetURLWithParams|OpenURL|OpenExternalBrowserURL)\b/i.test(text)) reasons.add('browser');
        if (/\b(?:eval|Function)\s*\(/.test(text) || text === 'eval' || text === 'Function') reasons.add('dynamic-code');
        if (['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'RunScriptInPanelContext'].includes(text)) reasons.add('remote-code');
    }
    const text = source;
    if (javascript) {
        reasons.add('executable');
        try {
            const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
            const stack: AstNode[] = [node(ast)!];
            const bindings = new Map<string, string>();
            let count = 0;
            while (stack.length) {
                if (++count > 200000) throw new Error('AST limit');
                const n = stack.pop()!;
                if (n.type === 'VariableDeclarator') {
                    const id = node(n.id);
                    const value = constant(n.init, bindings);
                    if (id?.type === 'Identifier' && value !== undefined) bindings.set(String(id.name), value);
                }
                const value = constant(n, bindings);
                if (value !== undefined) inspectText(value);
                if (n.type === 'Identifier') {
                    const name = String(n.name);
                    inspectText(name);
                    if (name === 'eval' || name === 'Function') reasons.add('dynamic-code');
                    if (['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'RunScriptInPanelContext'].includes(name)) reasons.add('remote-code');
                }
                if (n.type === 'ImportExpression' || n.type === 'ImportDeclaration') reasons.add('remote-code');
                const children: AstNode[] = [];
                for (const v of Object.values(n)) {
                    if (Array.isArray(v)) { for (const item of v) { const c = node(item); if (c) children.push(c); } }
                    else { const c = node(v); if (c) children.push(c); }
                }
                stack.push(...children.reverse());
            }
        } catch {
            reasons.add('uninspectable');
        }
    } else {
        const withoutComments = text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '');
        const decoded = decodeEntities(withoutComments);
        inspectText(decoded);
        if (/<(?:script|scripts|iframe|object|embed)\b|\bon[a-z]+\s*=/i.test(withoutComments)) reasons.add('executable');
        if (/<(?:script|include|iframe|object|embed)\b[^>]*\b(?:src|href|url)\s*=\s*["']\s*(?:https?:|\/\/|data:|blob:)/i.test(decoded)) reasons.add('remote-code');
        for (const match of withoutComments.matchAll(/\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi)) {
            for (const finding of inspectModSource(entry, panoramaEventSource(decodeEntities(match[2])), true)) reasons.add(finding.reason);
        }
        for (const match of withoutComments.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
            const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(match[1]);
            const body = cdata ? cdata[1] : decodeEntities(match[1]);
            for (const finding of inspectModSource(entry, body, true)) reasons.add(finding.reason);
        }
    }
    return [...reasons].map(reason => ({ entry, reason }));
}
