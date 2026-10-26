import { describe, expect, it } from 'vitest';
import { isGlobalSkinSource, skinEditLinkSchema, skinEditSourceSchema, skinPartPatternSchema } from './skinEditSchema';

const request = (metaKey: string) => ({ heroName: 'Abrams', skinSources: [{ metaKey, priority: 5 }] });

describe('skin edit sources', () => {
  it('keeps old pattern drafts without density and validates finite Moo density', () => {
    const pattern = { style: 'moo', intensity: 1, phase: 0, scroll: .5 };
    expect(skinPartPatternSchema.parse(pattern)).toEqual(pattern);
    for (const scale of [.25, 1, 2.25, 8]) expect(skinPartPatternSchema.parse({ ...pattern, scale }).scale).toBe(scale);
    for (const scale of [.24, 8.01, NaN, Infinity]) expect(skinPartPatternSchema.safeParse({ ...pattern, scale }).success).toBe(false);
  });
  it('edits base and overflow skins but never a Global one', () => {
    expect(skinEditSourceSchema.safeParse(request('pak05_dir.vpk')).success).toBe(true);
    expect(skinEditSourceSchema.safeParse(request('addons2/pak05_dir.vpk')).success).toBe(true);
    expect(skinEditSourceSchema.safeParse(request('grimoire/pak05_dir.vpk')).success).toBe(false);
  });

  it('keeps a Locker link that names a Global skin so the editor can report it', () => {
    const link = skinEditLinkSchema.safeParse(request('grimoire/pak05_dir.vpk'));
    expect(link.success && link.data.skinSources.some(isGlobalSkinSource)).toBe(true);
    expect(skinEditLinkSchema.safeParse(request('other/pak05_dir.vpk')).success).toBe(false);
    expect(isGlobalSkinSource({ metaKey: 'Parked_dir.vpk', priorityMod: true })).toBe(true);
    expect(isGlobalSkinSource({ metaKey: 'pak05_dir.vpk' })).toBe(false);
  });
});
