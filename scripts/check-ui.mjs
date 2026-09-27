#!/usr/bin/env node
// Design-system ratchet for the renderer. Counts violations of the rules in
// docs/ui-conventions.md per file and fails when any file gains one relative to
// scripts/ui-baseline.json. Existing debt is grandfathered; it can only shrink.
//
//   pnpm ui:check            check against the baseline
//   pnpm ui:check --update   rewrite the baseline (after paying debt down)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const baselinePath = join(root, 'scripts/ui-baseline.json');

const PALETTE = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';

const RULES = {
    'raw-hex': {
        hint: 'use a token from @theme in src/index.css (add one if it is new and reusable)',
        re: /-\[#[0-9a-fA-F]{3,8}\]/g,
    },
    'raw-palette': {
        hint: 'use a semantic token (state-*, accent, text-*, bg-*, brand-*)',
        re: new RegExp(`\\b(?:text|bg|border(?:-[tblrxy])?|ring|from|via|to|fill|stroke|divide|outline|shadow|decoration|caret)-(?:${PALETTE})-\\d{2,3}\\b`, 'g'),
    },
    'focus-ring': {
        hint: 'use focus-visible:ring-* so the ring only shows for keyboard focus',
        re: /(?<![\w-])focus:ring\b/g,
    },
    'white-tint': {
        hint: 'use hl/N for translucent surface tints (bg-hl/5, border-hl/10)',
        re: /\b(?:border|bg|ring|divide|outline)-white\//g,
    },
    'em-dash': {
        hint: 'no em-dashes: use a colon, period or parens',
        re: /—/g,
    },
};

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return e.name === 'locales' ? [] : walk(p);
        return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
    });
}

const counts = {};
for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file);
    for (const [rule, { re }] of Object.entries(RULES)) {
        const n = text.match(re)?.length ?? 0;
        if (n) (counts[rel] ??= {})[rule] = n;
    }
}

if (process.argv.includes('--update')) {
    const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
    writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`ui:check baseline written (${Object.keys(sorted).length} files)`);
    process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const failures = [];
let shrunk = false;
for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    for (const rule of Object.keys(RULES)) {
        const now = counts[file]?.[rule] ?? 0;
        const was = baseline[file]?.[rule] ?? 0;
        if (now > was) failures.push(`${file}: ${rule} ${was} -> ${now} (${RULES[rule].hint})`);
        else if (now < was) shrunk = true;
    }
}

if (failures.length) {
    console.error('ui:check found new design-system violations:\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nSee docs/ui-conventions.md.');
    process.exit(1);
}
console.log('ui:check ok');
if (shrunk) console.log('Debt went down. Run `pnpm ui:check --update` to lock it in.');
