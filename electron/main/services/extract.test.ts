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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32, deflateRawSync } from 'zlib';
import AdmZip from 'adm-zip';
import { checkOneClickOptOut, extractArchive, listArchiveContents, scanSuspiciousFiles } from './extract';

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

function rawZip(declaredSize: number, compressed = deflateRawSync(Buffer.from('123456789'))): Buffer {
  const name = Buffer.from('fixture_dir.vpk');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0xcbf43926, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0xcbf43926, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

function extractInChild(archive: Buffer) {
  const root = mkdtempSync(join(tmpdir(), 'extract-robustness-'));
  const archivePath = join(root, 'fixture.zip');
  const dest = join(root, 'out');
  writeFileSync(archivePath, archive);
  mkdirSync(dest);
  try {
    const child = spawnSync(process.execPath, [
      '--max-old-space-size=64', '--import=tsx', '--input-type=module', '-e', `
        import { extractArchive } from ${JSON.stringify(new URL('./extract.ts', import.meta.url).href)};
        import { readFileSync } from 'node:fs';
        let result;
        try {
          const files = await extractArchive(process.argv[1], process.argv[2]);
          result = { contents: files.map(file => readFileSync(file.path, 'utf8')) };
        } catch (error) {
          result = { error: error.message };
        }
        console.log(JSON.stringify({ ...result, maxRssKiB: process.resourceUsage().maxRSS }));
      `, archivePath, dest,
    ], { encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.signal, child.stderr).toBeNull();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout.trim());
    // V8's heap cap excludes Buffers, so also check the child's peak resident memory.
    expect(result.maxRssKiB).toBeLessThan(256 * 1024);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('extractArchive (raw ZIP robustness)', () => {
  it('extracts a valid raw-byte control fixture', () => {
    expect(extractInChild(rawZip(9)).contents).toEqual(['123456789']);
  });

  it('handles a 1 GiB declared size without unbounded resident memory', () => {
    expect(extractInChild(rawZip(1024 ** 3)).contents).toEqual(['123456789']);
  }, 20000);

  it('rejects a truncated deflate stream with a handled error', () => {
    const compressed = deflateRawSync(Buffer.from('123456789')).subarray(0, -2);
    expect(extractInChild(rawZip(9, compressed)).error).toEqual(expect.any(String));
  });

  it('rejects a zero declared size with real compressed data', () => {
    expect(extractInChild(rawZip(0)).error).toEqual(expect.any(String));
  });
});

/** A stored (uncompressed) zip with raw name bytes and no UTF-8 flag, like older Windows tools write. */
function storedZip(entries: { name: Buffer; data: Buffer }[]): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // DOS date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localEntries.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, directory, end]);
}

describe('archives with legacy code page entry names', () => {
  let root: string;
  let extracted: Awaited<ReturnType<typeof extractArchive>>;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'extract-gbk-test-'));
    const zipPath = join(root, 'gbk.zip');
    const dest = join(root, 'out');
    mkdirSync(dest);
    // 红色/ and 蓝色/ in GBK: both decode to the same U+FFFD string as UTF-8.
    writeFileSync(zipPath, storedZip([
      { name: Buffer.concat([Buffer.from([0xba, 0xec, 0xc9, 0xab]), Buffer.from('/pak01_dir.vpk')]), data: Buffer.from('RED') },
      { name: Buffer.concat([Buffer.from([0xc0, 0xb6, 0xc9, 0xab]), Buffer.from('/pak01_dir.vpk')]), data: Buffer.from('BLUE') },
    ]));
    extracted = await extractArchive(zipPath, dest);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps both variants in-process with distinct folder labels', () => {
    const byFolder = Object.fromEntries(extracted.map((e) => [e.archiveFolder, readFileSync(e.path, 'utf8')]));
    expect(byFolder).toEqual({
      [Buffer.from([0xba, 0xec, 0xc9, 0xab]).toString('latin1')]: 'RED',
      [Buffer.from([0xc0, 0xb6, 0xc9, 0xab]).toString('latin1')]: 'BLUE',
    });
  });
});

describe('archives with duplicate entry names', () => {
  let root: string;
  let zipPath: string;
  let dest: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'extract-duplicate-test-'));
    zipPath = join(root, 'duplicate.zip');
    dest = join(root, 'out');
    mkdirSync(dest);
    const name = Buffer.from('pak01_dir.vpk');
    writeFileSync(zipPath, storedZip([
      { name, data: Buffer.from('FIRST') },
      { name, data: Buffer.from('SECOND') },
      { name: Buffer.from('setup.exe'), data: Buffer.from('MZ') },
    ]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('extracts through 7-Zip when adm-zip refuses the archive', async () => {
    const files = await extractArchive(zipPath, dest);
    expect(files.map((e) => e.fileName)).toEqual(['pak01_dir.vpk']);
    expect(readdirSync(dest)).toEqual(['pak01_dir.vpk']);
  });

  it('lists through 7-Zip so install preflight still sees every entry', async () => {
    await expect(listArchiveContents(zipPath)).resolves.toEqual(['pak01_dir.vpk', 'pak01_dir.vpk', 'setup.exe']);
    await expect(scanSuspiciousFiles(zipPath)).resolves.toEqual(['setup.exe']);
    await expect(checkOneClickOptOut(zipPath)).resolves.toEqual({ disabled: false });
  });
});
