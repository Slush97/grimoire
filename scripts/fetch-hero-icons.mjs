import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_NAMES } from '../node_modules/@grimoire/social-types/src/heroes.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');
const outDir = join(repoRoot, 'public', 'heroes', 'icons');
const API_URL = 'https://deadlock.wiki/api.php';

const WIKI_FILE_OVERRIDES = {
  Doorman: 'The_Doorman',
  'Mo & Krill': 'Mo_&_Krill',
};

function heroIconAssetName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function defaultWikiBaseName(name) {
  return name.trim().replace(/\s+/g, '_');
}

async function resolveImage(heroName) {
  const wikiBaseName = WIKI_FILE_OVERRIDES[heroName] ?? defaultWikiBaseName(heroName);
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    iiprop: 'url|size',
    titles: `File:${wikiBaseName}.png`,
  });

  const res = await fetch(`${API_URL}?${params.toString()}`, {
    headers: { 'User-Agent': 'grimoire-fetch-hero-icons/1.0' },
  });
  if (!res.ok) {
    throw new Error(`wiki API ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const page = Object.values(data.query?.pages ?? {})[0];
  const imageInfo = page?.imageinfo?.[0];
  if (!imageInfo?.url) {
    throw new Error(`missing wiki image File:${wikiBaseName}.png`);
  }
  return imageInfo;
}

async function download(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'grimoire-fetch-hero-icons/1.0' },
  });
  if (!res.ok) {
    throw new Error(`download ${res.status} ${res.statusText}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('image/png')) {
    throw new Error(`expected image/png, got ${type || 'unknown content type'}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

await mkdir(outDir, { recursive: true });

let failed = 0;
for (const heroName of HERO_NAMES) {
  const outName = `${heroIconAssetName(heroName)}.png`;
  try {
    const image = await resolveImage(heroName);
    const bytes = await download(image.url);
    await writeFile(join(outDir, outName), bytes);
    console.log(`[hero-icons] ${heroName} -> ${outName} (${image.width}x${image.height})`);
  } catch (err) {
    failed += 1;
    console.error(`[hero-icons] ${heroName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failed > 0) {
  throw new Error(`${failed} hero icon${failed === 1 ? '' : 's'} failed to download`);
}
