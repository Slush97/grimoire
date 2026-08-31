import { describe, expect, it } from 'vitest';
import {
  VPK_IMPORT_RE,
  classifyDroppedModFiles,
  deriveModNameFromPath,
  deriveVariantLabel,
  fileNameOf,
  pathDedupeKey,
  resolveImportedVariantLabel,
} from './customModImport';

describe('deriveModNameFromPath', () => {
  it('strips the _dir suffix and the vpk extension', () => {
    expect(deriveModNameFromPath('/home/u/mods/shiv_neon_dragon_dir.vpk')).toBe(
      'shiv neon dragon'
    );
  });

  it('strips a pakNN engine prefix', () => {
    expect(deriveModNameFromPath('pak07_wraith_bundle_dir.vpk')).toBe('wraith bundle');
  });

  it('strips a three-digit pak prefix from an overflow folder', () => {
    expect(deriveModNameFromPath('pak100_foo_dir.vpk')).toBe('foo');
  });

  it('leaves a bare slot name alone when there is nothing after the prefix', () => {
    expect(deriveModNameFromPath('pak01_dir.vpk')).toBe('pak01');
  });

  it('strips _dir from an archive too, not just a vpk', () => {
    expect(deriveModNameFromPath('C:\\Downloads\\wraith_bundle_dir.zip')).toBe('wraith bundle');
  });

  it('handles each supported archive extension', () => {
    expect(deriveModNameFromPath('cool-skin.zip')).toBe('cool skin');
    expect(deriveModNameFromPath('cool-skin.7z')).toBe('cool skin');
    expect(deriveModNameFromPath('cool-skin.rar')).toBe('cool skin');
  });

  it('takes the basename from either separator style', () => {
    expect(deriveModNameFromPath('C:\\Users\\me\\Downloads\\my_skin.vpk')).toBe('my skin');
    expect(deriveModNameFromPath('/var/tmp/my_skin.vpk')).toBe('my skin');
  });

  it('collapses runs of separators into a single space', () => {
    expect(deriveModNameFromPath('a__b--c.vpk')).toBe('a b c');
  });

  it('returns an empty string when nothing survives the strip', () => {
    expect(deriveModNameFromPath('_dir.vpk')).toBe('');
  });
});

describe('local variant labels', () => {
  it('formats the existing filename fallback for display', () => {
    expect(deriveVariantLabel('pak66_dir (1).vpk')).toBe('Pak66 Dir (1)');
    expect(deriveVariantLabel('no_beard')).toBe('No Beard');
  });

  it('uses an exact custom name for a single VPK', () => {
    expect(resolveImportedVariantLabel('Gold', 'pak66_dir', 1, 0)).toBe('Gold');
  });

  it('keeps archive members distinct beneath a custom prefix', () => {
    expect(resolveImportedVariantLabel('Season Pack', 'no_beard', 2, 0)).toBe(
      'Season Pack: No Beard'
    );
    expect(resolveImportedVariantLabel('Season Pack', undefined, 2, 1)).toBe(
      'Season Pack: Variant 2'
    );
  });

  it('preserves the generated fallback when no custom name is entered', () => {
    expect(resolveImportedVariantLabel(undefined, 'pak66_dir', 1, 0)).toBe('Pak66 Dir');
  });
});

describe('pathDedupeKey', () => {
  it('folds case on Windows so one file cannot occupy two rows', () => {
    const a = 'C:\\Users\\Me\\mod_dir.vpk';
    const b = 'c:\\users\\me\\MOD_dir.vpk';
    expect(pathDedupeKey(a, 'win32')).toBe(pathDedupeKey(b, 'win32'));
  });

  it('keeps POSIX paths case-sensitive', () => {
    expect(pathDedupeKey('/home/u/Mod.vpk', 'linux')).not.toBe(
      pathDedupeKey('/home/u/mod.vpk', 'linux')
    );
  });
});

describe('fileNameOf', () => {
  it('handles both separator styles and a bare name', () => {
    expect(fileNameOf('/a/b/c.vpk')).toBe('c.vpk');
    expect(fileNameOf('a\\b\\c.vpk')).toBe('c.vpk');
    expect(fileNameOf('c.vpk')).toBe('c.vpk');
  });
});

describe('VPK_IMPORT_RE', () => {
  it('accepts vpk and every supported archive, case-insensitively', () => {
    for (const name of ['a.vpk', 'a.VPK', 'a.zip', 'a.7z', 'a.rar', 'a.RaR']) {
      expect(VPK_IMPORT_RE.test(name)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const name of ['a.png', 'a.vpk.txt', 'a.tar.gz', 'vpk']) {
      expect(VPK_IMPORT_RE.test(name)).toBe(false);
    }
  });
});

describe('classifyDroppedModFiles', () => {
  /** Only `.name` is read by the parser; the resolver keys off it too. */
  const dropped = (...names: string[]) => names.map((name) => ({ name }) as File);
  const resolveUnder = (dir: string) => (file: File) => `${dir}/${file.name}`;

  it('accepts a vpk and every supported archive, case-insensitively', () => {
    const files = dropped('a.vpk', 'b.VPK', 'c.zip', 'd.7z', 'e.RaR');
    const result = classifyDroppedModFiles(files, resolveUnder('/drop'));
    expect(result.paths).toEqual([
      '/drop/a.vpk',
      '/drop/b.VPK',
      '/drop/c.zip',
      '/drop/d.7z',
      '/drop/e.RaR',
    ]);
    expect(result.rejectedNames).toEqual([]);
    expect(result.unresolvedCount).toBe(0);
  });

  it('rejects unsupported files by name and resolves none of them', () => {
    const resolve = (file: File) => `/drop/${file.name}`;
    const result = classifyDroppedModFiles(dropped('notes.txt', 'thumb.png'), resolve);
    expect(result.paths).toEqual([]);
    expect(result.rejectedNames).toEqual(['notes.txt', 'thumb.png']);
    expect(result.unresolvedCount).toBe(0);
  });

  it('keeps the supported files from a mixed drop', () => {
    const files = dropped('skin.vpk', 'readme.md', 'bundle.zip', 'cover.jpg');
    const result = classifyDroppedModFiles(files, resolveUnder('/drop'));
    expect(result.paths).toEqual(['/drop/skin.vpk', '/drop/bundle.zip']);
    expect(result.rejectedNames).toEqual(['readme.md', 'cover.jpg']);
    expect(result.unresolvedCount).toBe(0);
  });

  it('counts supported files that resolve to no on-disk path', () => {
    const files = dropped('real.vpk', 'virtual.vpk', 'alsoVirtual.zip');
    const result = classifyDroppedModFiles(files, (file) =>
      file.name === 'real.vpk' ? '/drop/real.vpk' : ''
    );
    expect(result.paths).toEqual(['/drop/real.vpk']);
    expect(result.rejectedNames).toEqual([]);
    expect(result.unresolvedCount).toBe(2);
  });

  it('preserves the source order of the drop', () => {
    const files = dropped('z.vpk', 'a.zip', 'm.rar');
    const result = classifyDroppedModFiles(files, resolveUnder('C:\\Downloads'));
    expect(result.paths).toEqual([
      'C:\\Downloads/z.vpk',
      'C:\\Downloads/a.zip',
      'C:\\Downloads/m.rar',
    ]);
  });

  it('handles an empty file list without calling the resolver', () => {
    let calls = 0;
    const result = classifyDroppedModFiles([], () => {
      calls++;
      return '/never';
    });
    expect(result).toEqual({ paths: [], rejectedNames: [], unresolvedCount: 0 });
    expect(calls).toBe(0);
  });
});
