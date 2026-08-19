import { describe, expect, it } from 'vitest';
import {
  VPK_IMPORT_RE,
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
      'Season Pack — No Beard'
    );
    expect(resolveImportedVariantLabel('Season Pack', undefined, 2, 1)).toBe(
      'Season Pack — Variant 2'
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
