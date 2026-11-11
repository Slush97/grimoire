import { describe, expect, it } from 'vitest';
import {
  VPK_IMPORT_RE,
  classifyDroppedModFiles,
  cleanImprintNaming,
  cleanImprintText,
  deriveModNameFromPath,
  deriveVariantLabel,
  imprintVariantLabel,
  fileNameOf,
  pathDedupeKey,
  planLocalImport,
  resolveImportedVariantLabel,
  suggestVariantGroupName,
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

describe('variant labels from imprints', () => {
  const hud = { title: 'Minimal HUD' };
  const lighting = { title: 'Brighter lighting' };

  it('labels a file with its imprint title when no other member carries it', () => {
    expect(imprintVariantLabel(hud, [hud, lighting, null], 'Comp pack')).toBe('Minimal HUD');
  });

  it('uses the recorded variant label for files of one mod', () => {
    const gold = { title: 'Royal Abrams', variantLabel: 'Gold' };
    const silver = { title: 'royal abrams', variantLabel: 'Silver' };
    expect(imprintVariantLabel(gold, [gold, silver], 'Skins')).toBe('Gold');
    expect(imprintVariantLabel(silver, [gold, silver], 'Skins')).toBe('Silver');
  });

  it('does not repeat the group name as a label', () => {
    expect(imprintVariantLabel(hud, [hud], ' minimal hud ')).toBeUndefined();
    expect(imprintVariantLabel({ ...hud, variantLabel: 'Compact' }, [hud], 'Minimal HUD')).toBe('Compact');
  });

  it('has nothing to offer for a file without an imprint', () => {
    expect(imprintVariantLabel(null, [hud, null], 'Comp pack')).toBeUndefined();
  });

  it('prefers the imprint label over the file name for an archive member', () => {
    expect(resolveImportedVariantLabel(undefined, 'addons', 3, 0, 'Minimal HUD')).toBe('Minimal HUD');
    expect(resolveImportedVariantLabel('Pack', 'addons', 3, 0, 'Minimal HUD')).toBe('Pack: Minimal HUD');
  });
});

describe('cleanImprintText', () => {
  it('turns control characters and runs of whitespace into single spaces', () => {
    expect(cleanImprintText('  Minimal\u0000\r\n\tHUD\u007f \u0085v2  ')).toBe('Minimal HUD v2');
    expect(cleanImprintText('a\u{2028}b\u{a0}\u{a0}c')).toBe('a b c');
  });

  it('drops bidi overrides and zero-width characters', () => {
    expect(cleanImprintText('\u{202e}DUH\u{202c} Minimal\u{200b}')).toBe('DUH Minimal');
    expect(cleanImprintText('\u{200b}\u{200d}\u{feff}')).toBeUndefined();
  });

  it('caps the length without leaving half a surrogate pair', () => {
    expect(cleanImprintText('x'.repeat(1_000_000))).toBe('x'.repeat(120));
    expect(cleanImprintText(`${'x'.repeat(119)}\u{1f525}tail`)).toBe('x'.repeat(119));
    expect(cleanImprintText(`${'x'.repeat(118)} \u{1f525}`)).toBe('x'.repeat(118));
  });

  it('treats nothing left as absent', () => {
    expect(cleanImprintText(undefined)).toBeUndefined();
    expect(cleanImprintText('')).toBeUndefined();
    expect(cleanImprintText(' \u0000\n\t ')).toBeUndefined();
  });

  it('leaves ordinary text alone', () => {
    expect(cleanImprintText('Neon Vindicta (Red) [v1.2]')).toBe('Neon Vindicta (Red) [v1.2]');
    expect(cleanImprintText('Mina \u{30b4}\u{30fc}\u{30b9}\u{30c8} \u{1f47b}')).toBe('Mina \u{30b4}\u{30fc}\u{30b9}\u{30c8} \u{1f47b}');
  });
});

describe('cleanImprintNaming', () => {
  it('cleans title, author and variant label and keeps the rest', () => {
    expect(
      cleanImprintNaming({
        title: ' Neon\nVindicta ',
        author: 'A'.repeat(500),
        variantLabel: '\u0000',
        gamebananaId: 5,
        kind: 'mod' as const,
      })
    ).toEqual({
      title: 'Neon Vindicta',
      author: 'A'.repeat(120),
      variantLabel: undefined,
      gamebananaId: 5,
      kind: 'mod',
    });
  });
});

describe('suggestVariantGroupName', () => {
  it('offers the first row name when the files are not known to be different mods', () => {
    expect(suggestVariantGroupName([{ name: ' skin gold ' }, { name: 'skin silver' }])).toBe('skin gold');
    expect(
      suggestVariantGroupName([
        { name: 'Royal Abrams', imprintTitle: 'Royal Abrams' },
        { name: 'Royal Abrams', imprintTitle: 'royal abrams' },
        { name: 'extra' },
      ])
    ).toBe('Royal Abrams');
  });

  it('offers nothing when the imprints name different mods', () => {
    expect(
      suggestVariantGroupName([
        { name: 'Minimal HUD', imprintTitle: 'Minimal HUD' },
        { name: 'Brighter lighting', imprintTitle: 'Brighter lighting' },
      ])
    ).toBe('');
    expect(suggestVariantGroupName([])).toBe('');
  });
});

describe('planLocalImport', () => {
  const ids = () => {
    let next = 0;
    return () => `group-${++next}`;
  };

  it('leaves a lone VPK standalone and unlabelled', () => {
    expect(planLocalImport([{ seed: 'pak01_dir' }], 'My mod', undefined, undefined, ids())).toEqual([
      { modName: 'My mod', localGroupId: undefined, variantLabel: undefined },
    ]);
  });

  it('groups an archive without imprints as variants named after their folders', () => {
    expect(
      planLocalImport([{ seed: 'gold' }, { seed: 'no_beard' }], 'Skin', undefined, undefined, ids())
    ).toEqual([
      { modName: 'Skin', localGroupId: 'group-1', variantLabel: 'Gold' },
      { modName: 'Skin', localGroupId: 'group-1', variantLabel: 'No Beard' },
    ]);
  });

  it('keeps an archive of one imprinted mod as variants', () => {
    const plan = planLocalImport(
      [
        { seed: 'pak01_dir', imprint: { title: 'Royal Abrams', gamebananaId: 7, variantLabel: 'Gold' } },
        { seed: 'pak02_dir', imprint: { title: 'Royal Abrams', gamebananaId: 7 } },
      ],
      'royal',
      undefined,
      undefined,
      ids()
    );
    expect(plan).toEqual([
      { modName: 'royal', localGroupId: 'group-1', variantLabel: 'Gold' },
      { modName: 'royal', localGroupId: 'group-1', variantLabel: 'Pak02 Dir' },
    ]);
  });

  it('imports an archive whose imprints name different mods as those mods', () => {
    const plan = planLocalImport(
      [
        { seed: 'addons', imprint: { title: 'Minimal HUD' } },
        { seed: 'addons', imprint: { title: 'Brighter lighting', gamebananaId: 12 } },
        { seed: 'addons' },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan).toEqual([
      { modName: 'Minimal HUD' },
      { modName: 'Brighter lighting', ownThumbnail: true },
      { modName: 'Comp pack: Addons' },
    ]);
  });

  it('names unimprinted pack members after their files when they share a folder', () => {
    const plan = planLocalImport(
      [
        { seed: 'addons', stem: 'pak01_dir', imprint: { title: 'Minimal HUD', gamebananaId: 3 } },
        { seed: 'addons', stem: 'crosshair_dir' },
        { seed: 'addons', stem: 'brighter_dir' },
        { seed: 'extras', stem: 'pak04_dir' },
        { seed: 'Extras', stem: 'pak05_dir', imprint: { title: 'Sprays' } },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan).toEqual([
      { modName: 'Minimal HUD', ownThumbnail: true },
      { modName: 'Comp pack: Crosshair Dir' },
      { modName: 'Comp pack: Brighter Dir' },
      { modName: 'Comp pack: Pak04 Dir' },
      { modName: 'Sprays' },
    ]);
  });

  it('keeps folder labels when they are all different', () => {
    const plan = planLocalImport(
      [
        { seed: 'gold', stem: 'a_dir', imprint: { title: 'Minimal HUD', gamebananaId: 3 } },
        { seed: 'silver', stem: 'b_dir', imprint: { title: 'Brighter lighting' } },
        { seed: 'bronze', stem: 'c_dir' },
        { seed: 'copper', stem: 'd_dir' },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan.map((entry) => entry.modName)).toEqual([
      'Minimal HUD',
      'Brighter lighting',
      'Comp pack: Bronze',
      'Comp pack: Copper',
    ]);
  });

  it('flags only pack members that carry a GameBanana id as keeping their own thumbnail', () => {
    const plan = planLocalImport(
      [
        { seed: 'a', imprint: { title: 'Minimal HUD', gamebananaId: 3 } },
        { seed: 'b', imprint: { title: 'Brighter lighting' } },
        { seed: 'c' },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan.map((entry) => entry.ownThumbnail)).toEqual([true, undefined, undefined]);

    const oneMod = planLocalImport(
      [
        { seed: 'a', imprint: { title: 'Royal Abrams', gamebananaId: 7 } },
        { seed: 'b', imprint: { title: 'Royal Abrams', gamebananaId: 7 } },
      ],
      'royal',
      undefined,
      undefined,
      ids()
    );
    expect(oneMod.map((entry) => entry.ownThumbnail)).toEqual([undefined, undefined]);
  });

  it('still groups files of one mod inside a pack', () => {
    const plan = planLocalImport(
      [
        { seed: 'pak01_dir', imprint: { title: 'Royal Abrams', gamebananaId: 7, variantLabel: 'Gold' } },
        { seed: 'pak02_dir', imprint: { title: 'Minimal HUD' } },
        { seed: 'pak03_dir', imprint: { title: 'Royal Abrams', gamebananaId: 7 } },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan).toEqual([
      { modName: 'Royal Abrams', localGroupId: 'group-1', variantLabel: 'Gold', ownThumbnail: true },
      { modName: 'Minimal HUD' },
      { modName: 'Royal Abrams', localGroupId: 'group-1', variantLabel: 'Pak03 Dir', ownThumbnail: true },
    ]);
  });

  it('tells grouped members of one mod apart by file when they share a folder', () => {
    const plan = planLocalImport(
      [
        { seed: 'addons', stem: 'pak01_dir', imprint: { title: 'Royal Abrams', gamebananaId: 7 } },
        { seed: 'addons', stem: 'pak02_dir', imprint: { title: 'Royal Abrams', gamebananaId: 7 } },
        { seed: 'addons', stem: 'pak03_dir', imprint: { title: 'Minimal HUD' } },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan.map((entry) => entry.variantLabel)).toEqual(['Pak01 Dir', 'Pak02 Dir', undefined]);
  });

  it('plans names from imprint text that was already cleaned', () => {
    const plan = planLocalImport(
      [
        { seed: 'a', imprint: cleanImprintNaming({ title: ' Minimal\u0000\nHUD ' }) },
        { seed: 'b', imprint: cleanImprintNaming({ title: 'x'.repeat(1_000_000), gamebananaId: 9 }) },
      ],
      'Comp pack',
      undefined,
      undefined,
      ids()
    );
    expect(plan[0].modName).toBe('Minimal HUD');
    expect(plan[1].modName).toBe('x'.repeat(120));
  });

  it('joins an existing group whatever the imprints say, labelled by imprint', () => {
    const plan = planLocalImport(
      [
        { seed: 'addons', imprint: { title: 'Minimal HUD' } },
        { seed: 'addons', imprint: { title: 'Brighter lighting' } },
      ],
      'Comp pack',
      undefined,
      'existing',
      ids()
    );
    expect(plan).toEqual([
      { modName: 'Comp pack', localGroupId: 'existing', variantLabel: 'Minimal HUD' },
      { modName: 'Comp pack', localGroupId: 'existing', variantLabel: 'Brighter lighting' },
    ]);
  });

  it('gives a bare VPK joining a group exactly the label the dialog sent', () => {
    expect(planLocalImport([{ seed: 'pak01_dir' }], 'Comp pack', 'Minimal HUD', 'existing', ids())).toEqual([
      { modName: 'Comp pack', localGroupId: 'existing', variantLabel: 'Minimal HUD' },
    ]);
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
