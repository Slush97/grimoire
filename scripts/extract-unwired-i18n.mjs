// Finds hardcoded user-facing strings in renderer pages/components and can
// append them to the unwired staging catalog (src/locales/unwired-en.json)
// under unwired.* keys. These are a developer to-do list of strings still to be
// wired to t()/Tx; they are deliberately kept OUT of translation.json so Weblate
// only ever sees real, displayed strings. See grimoire/CLAUDE.md (i18n).
//
// Report only:
//   pnpm i18n:extract-unwired
//
// Merge candidates into the staging catalog:
//   pnpm i18n:extract-unwired -- --merge

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(root, 'src');
const scanRoots = [join(srcRoot, 'pages'), join(srcRoot, 'components')];
const catalogPath = join(srcRoot, 'locales/en/translation.json');
const unwiredPath = join(srcRoot, 'locales/unwired-en.json');
const reportPath = join(root, 'reports/i18n-unwired-candidates.json');
const shouldMerge = process.argv.includes('--merge');

const USER_FACING_PROP_NAMES = new Set([
  'aria-label',
  'alt',
  'cancelLabel',
  'confirmLabel',
  'description',
  'emptyLabel',
  'emptyMessage',
  'emptyTitle',
  'header',
  'heading',
  'helperText',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'text',
  'title',
  'tooltip',
]);

const USER_FACING_CALLS = new Set([
  'alert',
  'confirm',
  'setError',
  'setLocalError',
  'setStatus',
  'setWarning',
  'showError',
  'showToast',
  'toast',
]);

const EXCLUDED_FILES = [
  /\/translation\//,
  /\/common\/BrandIcons\.tsx$/,
  /\/crosshair\/drawCrosshair\.ts$/,
  /\/stats\/statlocker\.ts$/,
];

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
// Staging catalog of not-yet-wired English strings. A candidate counts as
// "known" if it is already staged here OR already present in the real catalog,
// so a string that has since been wired is never re-suggested.
const unwiredCatalog = existsSync(unwiredPath)
  ? JSON.parse(readFileSync(unwiredPath, 'utf8'))
  : { unwired: {} };
const existingKeys = new Set([...flattenKeys(catalog), ...flattenKeys(unwiredCatalog)]);
const files = scanRoots.flatMap((dir) => walk(dir));
const candidates = new Map();

for (const file of files) scanFile(file);

const rows = [...candidates.values()].sort((a, b) => a.key.localeCompare(b.key));
writeJson(reportPath, {
  generatedAt: new Date().toISOString(),
  note: 'Review these strings before merging. They are not translated live until the app code is wired to t()/Tx keys.',
  total: rows.length,
  rows,
});

if (shouldMerge) {
  for (const row of rows) setCatalogValue(unwiredCatalog, row.key, row.source);
  writeJson(unwiredPath, unwiredCatalog);
}

console.log(`${rows.length} unwired i18n candidates written to ${relative(root, reportPath)}.`);
console.log(
  shouldMerge
    ? `Merged candidates into ${relative(root, unwiredPath)} (staging only; not sent to Weblate).`
    : 'Run with --merge to append candidates to the unwired staging catalog.'
);

function scanFile(file) {
  if (EXCLUDED_FILES.some((pattern) => pattern.test(file))) return;

  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  function visit(node) {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (USER_FACING_PROP_NAMES.has(name) && node.initializer) {
        const value = literalFromInitializer(node.initializer);
        if (value) addCandidate(file, value, node, `jsx-attr:${name}`);
      }
    }

    if (ts.isJsxText(node)) {
      const value = normalizeText(node.getText(sourceFile));
      if (value) addCandidate(file, value, node, 'jsx-text');
    }

    if (ts.isPropertyAssignment(node)) {
      const propName = propertyName(node.name);
      if (propName && USER_FACING_PROP_NAMES.has(propName)) {
        const value = literalFromExpression(node.initializer);
        if (value) addCandidate(file, value, node.initializer, `object-prop:${propName}`);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      const varName = node.name.getText(sourceFile);
      if (looksUserFacingName(varName) && node.initializer) {
        const value = literalFromExpression(node.initializer);
        if (value) addCandidate(file, value, node.initializer, `variable:${varName}`);
      }
    }

    if (ts.isCallExpression(node)) {
      const callName = callExpressionName(node.expression);
      if (callName && USER_FACING_CALLS.has(callName)) {
        const value = node.arguments[0] ? literalFromExpression(node.arguments[0]) : null;
        if (value) addCandidate(file, value, node.arguments[0], `call:${callName}`);
      }
    }

    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'Error') {
      const value = node.arguments?.[0] ? literalFromExpression(node.arguments[0]) : null;
      if (value) addCandidate(file, value, node.arguments[0], 'new Error');
    }

    if (
      isStringLike(node) &&
      isRenderedJsxExpressionString(node) &&
      !isHandledStringContext(node) &&
      !isInsideJsxAttribute(node) &&
      !isTranslationKeyArg(node)
    ) {
      const value = literalText(node);
      if (value) addCandidate(file, value, node, 'jsx-expression');
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function addCandidate(file, rawValue, node, kind) {
  const source = normalizeText(rawValue);
  if (!isUserFacing(source)) return;

  const baseKey = keyFor(file, source);
  const key = uniqueKey(baseKey, source);
  if (existingKeys.has(key)) return;

  const pos = sourceLineAndColumn(file, node.getStart());
  const existing = candidates.get(key);
  if (existing) {
    existing.occurrences.push({ file: pos.file, line: pos.line, column: pos.column, kind });
    return;
  }

  candidates.set(key, {
    key,
    source,
    occurrences: [{ file: pos.file, line: pos.line, column: pos.column, kind }],
  });
}

function uniqueKey(baseKey, source) {
  let key = baseKey;
  let i = 2;
  while (candidates.has(key) && candidates.get(key).source !== source) {
    key = `${baseKey}${i}`;
    i += 1;
  }
  return key;
}

function keyFor(file, value) {
  const rel = relative(srcRoot, file)
    .replace(/\.(t|j)sx?$/, '')
    .split(/[\\/]/)
    .map(slugPart)
    .filter(Boolean)
    .join('.');
  return `unwired.${rel}.${slugPart(value) || `text${hash(value)}`}`;
}

function slugPart(value) {
  const words = value
    .replace(/{{\s*([\w.-]+)\s*}}/g, '$1')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  if (!words.length) return '';

  const [first, ...rest] = words;
  const slug = [
    first.toLowerCase(),
    ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()),
  ].join('');
  return /^[0-9]/.test(slug) ? `text${slug}` : slug.slice(0, 56);
}

function sourceLineAndColumn(file, pos) {
  const text = readFileSync(file, 'utf8');
  const before = text.slice(0, pos);
  const lines = before.split(/\r?\n/);
  return {
    file: relative(root, file),
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function literalFromInitializer(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) return literalFromExpression(node.expression);
  return null;
}

function literalFromExpression(node) {
  if (isStringLike(node)) return literalText(node);
  if (ts.isParenthesizedExpression(node)) return literalFromExpression(node.expression);
  return null;
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function callExpressionName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function isHandledStringContext(node) {
  const parent = node.parent;
  return (
    ts.isJsxAttribute(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent)
  );
}

function isInsideJsxAttribute(node) {
  let cursor = node.parent;
  while (cursor) {
    if (ts.isJsxAttribute(cursor)) return true;
    if (ts.isJsxElement(cursor) || ts.isJsxSelfClosingElement(cursor) || ts.isSourceFile(cursor)) return false;
    cursor = cursor.parent;
  }
  return false;
}

function isTranslationKeyArg(node) {
  const parent = node.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments[0] === node &&
    callExpressionName(parent.expression) === 't'
  );
}

function isRenderedJsxExpressionString(node) {
  let cursor = node.parent;
  while (cursor && !ts.isJsxExpression(cursor)) {
    if (
      ts.isFunctionLike(cursor) ||
      ts.isBlock(cursor) ||
      ts.isVariableStatement(cursor) ||
      ts.isVariableDeclaration(cursor) ||
      ts.isJsxAttribute(cursor)
    ) {
      return false;
    }
    cursor = cursor.parent;
  }

  if (!cursor || !ts.isJsxExpression(cursor) || !cursor.expression) return false;

  let walker = node;
  while (walker.parent && walker.parent !== cursor) {
    if (ts.isFunctionLike(walker.parent) || ts.isBlock(walker.parent)) return false;
    walker = walker.parent;
  }

  return true;
}

function looksUserFacingName(name) {
  return /(label|title|description|message|placeholder|tooltip|toast|error|empty|heading|subtitle)/i.test(name);
}

function isUserFacing(value) {
  if (!value) return false;
  if (value.length < 2 || value.length > 500) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/^[a-z0-9_.:-]+$/.test(value) && value === value.toLowerCase()) return false;
  if (/^(https?:|data:|file:|steam:|discord:)/i.test(value)) return false;
  if (/^[.#]?[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif|svg|mp3|wav|vpk|json|cfg|tsx?|jsx?)$/i.test(value)) return false;
  if (/^(true|false|null|undefined)$/i.test(value)) return false;
  return true;
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'locales') continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else if (/\.(t|j)sx?$/.test(entry.name)) out.push(file);
  }
  return out;
}

function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value) ? flattenKeys(value, path) : [path];
  });
}

function setCatalogValue(obj, dottedKey, value) {
  const parts = dottedKey.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i === parts.length - 1) {
      cursor[part] = value;
    } else {
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hash(value) {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) >>> 0;
  return out.toString(36);
}
