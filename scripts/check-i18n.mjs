// Validates the i18n catalog against the code.
//
//  1. Every t('literal.key') referenced in src/ must exist in the English
//     source catalog (a missing key renders the raw key string to users).
//  2. Reports catalog keys that no code references (informational only; may
//     have false positives for keys built dynamically, e.g. t(`hero.${id}`)).
//
// Run with: pnpm i18n:check   (exits non-zero if any referenced key is missing)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';

const root = fileURLToPath(new URL('..', import.meta.url));
const en = JSON.parse(readFileSync(join(root, 'src/locales/en/translation.json'), 'utf8'));

await i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'locales') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(t|j)sx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const keyRe = /\bt\(\s*['"]([\w.-]+)['"]/g;
const referenced = new Set();
const missing = [];
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = keyRe.exec(src))) {
    const key = m[1];
    referenced.add(key);
    // A missing key resolves to itself; count:2 lets plural keys resolve.
    if (i18next.t(key, { count: 2 }) === key) missing.push(`${file.replace(root, '')}: ${key}`);
  }
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const leaves = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' ? leaves(v, key) : [key];
  });
const bases = new Set(leaves(en).map((k) => k.replace(PLURAL, '')));
const unused = [...bases].filter((b) => !referenced.has(b)).sort();

if (missing.length) {
  console.error(`Missing keys (referenced in code, absent from en catalog): ${missing.length}`);
  for (const x of missing) console.error('  ' + x);
} else {
  console.log(`OK: all ${referenced.size} referenced keys exist in the en catalog.`);
}
if (unused.length) {
  console.warn(`\nUnused catalog keys (informational): ${unused.length}`);
  for (const x of unused) console.warn('  ' + x);
}

process.exit(missing.length ? 1 : 0);
