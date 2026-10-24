import { describe, expect, it } from 'vitest';
import { editForMaterial, materialBasename, skinTintVector } from './skinParts';
import { skinEditExportSchema, skinEditSourceSchema } from './skinEditSchema';

describe('skin editor boundaries', () => {
  it('maps glTF material names to full source paths and rejects ambiguous basenames', () => {
    const first = { material: 'models/hero/materials/coat.vmat', hidden: true, tint: null };
    expect(materialBasename('coat.vmat_c')).toBe('coat');
    expect(editForMaterial('coat.vmat', [first])).toBe(first);
    expect(editForMaterial('coat.vmat', [first, { ...first, material: 'models/other/coat.vmat' }])).toBeUndefined();
  });

  it('keeps authored VMAT tint values in sRGB, including midtones', () => {
    expect(skinTintVector('#8040ff')).toEqual([128 / 255, 64 / 255, 1]);
  });

  it.each(['../secret.vpk', 'C:\\secret.vpk', 'addons2/../../secret.vpk', '/secret.vpk'])('rejects source traversal %s', (metaKey) => {
    expect(skinEditSourceSchema.safeParse({ heroName: 'Seven', skinSources: [{ metaKey, priority: 1 }] }).success).toBe(false);
  });

  it('accepts overflow sources and rejects invalid tints before export', () => {
    const source = { heroName: 'Seven', skinSources: [{ metaKey: 'addons2/pak01_dir.vpk', priority: 2 }] };
    expect(skinEditSourceSchema.parse(source)).toEqual(source);
    expect(skinEditExportSchema.safeParse({ ...source, fingerprint: 'a'.repeat(64), edits: [{ material: 'coat.vmat', hidden: false, tint: 'blue' }] }).success).toBe(false);
  });
});
