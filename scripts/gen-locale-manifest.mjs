// Generates src/locales/manifest.json: the index the in-app language picker
// reads to list downloadable languages and how complete each one is.
//
// English (src/locales/en/translation.json) is the source of truth. For every
// other src/locales/<code>/translation.json, we count how many of the English
// leaf keys are present and non-empty, and express that as a percentage.
//
// Run after any locale change (and in CI on merge to main) so the committed
// manifest stays in step with the catalogs on `main`, which is what the app
// fetches at runtime.
//
//   node scripts/gen-locale-manifest.mjs        # write the manifest
//   node scripts/gen-locale-manifest.mjs --check # fail if it is out of date
//
// Run with: pnpm i18n:manifest

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const localesDir = join(root, 'src/locales');
const manifestPath = join(localesDir, 'manifest.json');
const SOURCE_LANGUAGE = 'en';

/** Flatten a nested catalog into dot-notation leaf entries [key, value]. */
function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, key) : [[key, v]];
  });
}

function readCatalog(code) {
  const file = join(localesDir, code, 'translation.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A leaf counts as translated when the key exists and its value is a non-empty
 *  string (after trimming). Missing keys and blank strings do not count. */
function filledCount(catalog, sourceKeys) {
  const map = new Map(leaves(catalog));
  let filled = 0;
  for (const key of sourceKeys) {
    const value = map.get(key);
    if (typeof value === 'string' && value.trim() !== '') filled += 1;
  }
  return filled;
}

/** Native display name, e.g. 'de' -> 'Deutsch'. Falls back to the raw code. */
function displayName(code) {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const source = readCatalog(SOURCE_LANGUAGE);
if (!source) {
  console.error(`Missing source catalog: src/locales/${SOURCE_LANGUAGE}/translation.json`);
  process.exit(1);
}
const sourceKeys = leaves(source).map(([key]) => key);
const totalKeys = sourceKeys.length;

const codes = readdirSync(localesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((code) => existsSync(join(localesDir, code, 'translation.json')))
  .sort();

const languages = codes.map((code) => {
  if (code === SOURCE_LANGUAGE) {
    return { code, name: displayName(code), translatedKeys: totalKeys, pct: 100 };
  }
  const catalog = readCatalog(code);
  const translatedKeys = filledCount(catalog, sourceKeys);
  const pct = totalKeys === 0 ? 0 : Math.round((translatedKeys / totalKeys) * 100);
  return { code, name: displayName(code), translatedKeys, pct };
});

const manifest = { sourceLanguage: SOURCE_LANGUAGE, totalKeys, languages };
const serialized = JSON.stringify(manifest, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
  if (current !== serialized) {
    console.error('locales/manifest.json is out of date. Run: pnpm i18n:manifest');
    process.exit(1);
  }
  console.log('locales/manifest.json is up to date.');
} else {
  writeFileSync(manifestPath, serialized);
  console.log(
    `Wrote ${manifestPath.replace(root, '')} (${languages.length} language(s), ${totalKeys} keys)`
  );
}
