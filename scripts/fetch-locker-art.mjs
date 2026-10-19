import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HERO_NAMES } from '../../grimoire-social/packages/social-types/src/heroes.ts';

// These are selected illustrations, not a mirror of each wiki file's latest upload.
const entries = JSON.parse(await readFile(new URL('./locker-artwork.json', import.meta.url), 'utf8'));
const heroes = new Set(HERO_NAMES.map((name) => name === 'The Doorman' ? 'Doorman' : name));
for (const hero of heroes) {
  if (!entries.some((entry) => entry.hero === hero)) throw new Error(`Missing Locker artwork source for ${hero}`);
}
if (entries.length !== heroes.size || new Set(entries.map((entry) => entry.hero)).size !== heroes.size) {
  throw new Error('Locker artwork sources must contain every roster hero exactly once');
}

const checkOnly = process.argv.includes('--check');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let updated = 0;
for (const entry of entries) {
  const fileNames = entry.hero === 'Doorman'
    ? ['Doorman_Render.png', 'The_Doorman_Render.png']
    : [`${entry.hero.replaceAll(' ', '_')}_Render.png`];
  let downloaded;
  for (const fileName of fileNames) {
    const path = new URL(`../public/locker/heroes/${encodeURIComponent(fileName)}`, import.meta.url);
    const local = await readFile(path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (local && hash(local) === entry.sha256) continue;
    if (checkOnly) throw new Error(`${fileName}: missing or different from the selected illustration`);
    if (!downloaded) {
      const response = await fetch(entry.url, { headers: { 'User-Agent': 'grimoire-fetch-locker-art/1.0' } });
      if (!response.ok) throw new Error(`${entry.hero}: download returned HTTP ${response.status}`);
      downloaded = Buffer.from(await response.arrayBuffer());
      if (hash(downloaded) !== entry.sha256) {
        throw new Error(`${entry.hero}: source image changed. Review it before updating the manifest.`);
      }
    }
    await writeFile(path, downloaded);
    console.log(`Updated ${fileURLToPath(path)}`);
    updated++;
  }
}
console.log(`Verified illustrated Locker artwork for all ${heroes.size} heroes. ${updated} files updated.`);
