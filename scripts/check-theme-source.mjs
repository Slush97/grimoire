import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const themePath = path.join(sourceRoot, 'index.css');
const sourceExtensions = new Set(['.ts', '.tsx', '.css']);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return sourceExtensions.has(path.extname(entry.name)) ? [absolute] : [];
  }));
  return nested.flat();
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function relative(file) {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

function addMatches(violations, file, source, pattern, message) {
  for (const match of source.matchAll(pattern)) {
    violations.push({
      file: relative(file),
      line: lineNumber(source, match.index),
      value: match[0],
      message,
    });
  }
}

function parseColorTokens(css) {
  return new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]));
}

function parseHexDeclarations(css, blockPattern) {
  const block = css.match(blockPattern)?.[1] ?? '';
  return new Map(
    [...block.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)]
      .map((match) => [match[1], match[2]])
  );
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const [r, g, b] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function checkStatusContrast(css, violations) {
  const defaults = parseHexDeclarations(css, /@theme\s*\{([\s\S]*?)\n\}/);
  const light = new Map(defaults);
  for (const [token, value] of parseHexDeclarations(css, /:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)) {
    light.set(token, value);
  }
  const states = ['state-success', 'state-warning', 'state-danger', 'state-info'];
  const surfaces = ['bg-primary', 'bg-secondary', 'bg-card'];
  for (const [theme, palette] of [['dark', defaults], ['light', light]]) {
    for (const state of states) {
      for (const surface of surfaces) {
        const foreground = palette.get(state);
        const background = palette.get(surface);
        if (!foreground || !background) continue;
        const ratio = contrast(foreground, background);
        if (ratio < 4.5) {
          violations.push({
            file: 'src/index.css',
            line: 1,
            value: `${theme}:${state} on ${surface} (${ratio.toFixed(2)}:1)`,
            message: 'semantic status text must meet WCAG AA for normal text',
          });
        }
      }
    }
  }
}

const themeCss = await readFile(themePath, 'utf8');
const definedColors = parseColorTokens(themeCss);
const violations = [];

for (const file of await sourceFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');

  addMatches(
    violations,
    file,
    source,
    /\btext-(?:yellow|amber|green|emerald|red|rose|blue|sky|cyan)-(?:50|[1-9]\d{2})(?:\/(?:\d+|\[.*?\]))?\b/g,
    'use text-state-success/warning/danger/info instead of a raw status shade'
  );
  addMatches(
    violations,
    file,
    source,
    /(?:bg-overlay-bg[^'"`\n]*text-(?:text|state|accent-ink)|text-(?:text|state|accent-ink)[^'"`\n]*bg-overlay-bg)/g,
    'dark media overlays must use an invariant overlay-* foreground'
  );
  addMatches(
    violations,
    file,
    source,
    /\btext-white(?:\/(?:\d+|\[.*?\]))?\b/g,
    'use theme text on app surfaces or overlay-* foregrounds on invariant media overlays'
  );

  const utilityPattern = /\b(?:text|bg|border|ring|fill|stroke|from|via|to)-((?:bg|text|state|overlay|accent|brand|hl)(?:-[a-z0-9]+)*|border)(?:\/(?:\d+|\[[^\]]+\]))?/g;
  for (const match of source.matchAll(utilityPattern)) {
    if (!definedColors.has(match[1])) {
      violations.push({
        file: relative(file),
        line: lineNumber(source, match.index),
        value: match[0],
        message: `undefined theme color utility (missing --color-${match[1]})`,
      });
    }
  }

  if (file.endsWith('.tsx')) {
    for (const match of source.matchAll(/<Tag\b[\s\S]*?>/g)) {
      if (!/variant=["']overlay["']/.test(match[0])) continue;
      const className = match[0].match(/className=["']([^"']*)["']/)?.[1];
      if (className && /(?:^|\s)(?:[a-z-]+:)*(?:text|bg|border|ring)-/.test(className)) {
        violations.push({
          file: relative(file),
          line: lineNumber(source, match.index),
          value: className,
          message: 'overlay Tag colors are owned by Tag; className may only adjust layout or typography',
        });
      }
    }
  }
}

checkStatusContrast(themeCss, violations);

if (violations.length > 0) {
  console.error(`Theme source check failed with ${violations.length} violation${violations.length === 1 ? '' : 's'}:`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.value}`);
    console.error(`    ${violation.message}`);
  }
  process.exitCode = 1;
} else {
  console.log('Theme source check passed.');
}
