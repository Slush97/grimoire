/**
 * Regression test for the multi-variant VPK collision. Mods like Tailed Infernus
 * (gamebanana.com/mods/666996) ship one folder per variant, each holding an
 * identically-named pakNN_dir.vpk. The extractor used to flatten by basename, so
 * the second variant silently overwrote the first on disk while still being
 * reported as extracted, which then crashed the install when the rename step
 * reached the file that no longer existed. Every variant must now survive under a
 * distinct path, tagged with its archive folder.
 *
 * extract.ts is electron-free (adm-zip / fs only), so this runs against the real
 * extractArchive with no mocking.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { extractArchive } from './extract';

describe('extractArchive (multi-variant VPK folders)', () => {
  let extracted: Awaited<ReturnType<typeof extractArchive>>;
  let dest: string;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'extract-test-'));
    dest = join(root, 'out');
    mkdirSync(dest, { recursive: true });

    // Two variant folders share the same pakNN name; a third VPK sits at the root.
    const zip = new AdmZip();
    zip.addFile('Tailed_mod_Beard/pak83_dir.vpk', Buffer.from('BEARD-CONTENT'));
    zip.addFile('Tailed_mod/pak83_dir.vpk', Buffer.from('NO-BEARD-CONTENT'));
    zip.addFile('root_skin_dir.vpk', Buffer.from('ROOT-CONTENT'));
    const zipPath = join(root, 'tailed.zip');
    zip.writeZip(zipPath);

    extracted = await extractArchive(zipPath, dest);
  });

  it('keeps every same-named variant instead of overwriting', () => {
    expect(extracted).toHaveLength(3);
    const paths = new Set(extracted.map((e) => e.path));
    expect(paths.size).toBe(3); // no two entries share a destination path
  });

  it('preserves each variant content (no silent clobber)', () => {
    const contents = extracted.map((e) => readFileSync(e.path, 'utf8')).sort();
    expect(contents).toEqual(['BEARD-CONTENT', 'NO-BEARD-CONTENT', 'ROOT-CONTENT']);
  });

  it('tags each VPK with its archive variant folder', () => {
    const byFolder = Object.fromEntries(
      extracted.map((e) => [e.archiveFolder ?? '(root)', readFileSync(e.path, 'utf8')])
    );
    expect(byFolder).toEqual({
      Tailed_mod_Beard: 'BEARD-CONTENT',
      Tailed_mod: 'NO-BEARD-CONTENT',
      '(root)': 'ROOT-CONTENT',
    });
  });

  it('reports the original basename for naming, even when the path was suffixed', () => {
    for (const e of extracted) {
      expect(e.fileName.toLowerCase().endsWith('.vpk')).toBe(true);
    }
    // The two colliding variants both report the original pak83_dir.vpk name.
    const pak83 = extracted.filter((e) => e.fileName === 'pak83_dir.vpk');
    expect(pak83).toHaveLength(2);
  });
});
