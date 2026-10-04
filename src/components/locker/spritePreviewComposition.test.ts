import { describe, expect, it } from 'vitest';
import { spriteParamsFor, type FxDescriptor } from './fxDescriptor';
import { balanceSpritePreviewComposition } from './spritePreviewComposition';

function composition() {
  const d: FxDescriptor = { name: 'contact', maxParticles: 1, controlPoints: [], emitters: [], initializers: [],
    operators: [{ class: 'C_OP_Decay', params: { m_nOpEndCapState: 'PARTICLE_ENDCAP_ENDCAP_ON' } }],
    renderers: [], children: [] };
  const core = spriteParamsFor(d, { class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: null,
    textures: ['glow.vtex'], params: { m_flRadiusScale: .12, m_flOverbrightFactor: 20 } })!;
  const soft = spriteParamsFor(d, { class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: 'ADD',
    textures: ['glow.vtex'], params: { m_flRadiusScale: .67, m_flAlphaScale: .15 } })!;
  const detail = spriteParamsFor({ ...d, maxParticles: 16, operators: [] }, { class: 'C_OP_RenderSprites', mode: 'sprite',
    blendMode: 'ADD', textures: ['detail.vtex'], params: { m_flOverbrightFactor: 6, m_bSaturateColorPreAlphaBlend: false,
      m_vecTexturesInput: [{ m_nTextureType: 'SPRITECARD_TEXTURE_UVDISTORTION' }, { m_nTextureType: 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP' }] } })!;
  return [core, soft, detail].map((l, i) => ({ ...l, attachment: 'contact', systemId: `root/0/${i}` }));
}
describe('bounded preview contact-glow composition', () => {
  it('balances only a complete sibling composition without changing authored inputs or colors', () => {
    const layers = composition(), before = JSON.stringify(layers);
    const balanced = balanceSpritePreviewComposition(layers);
    expect(balanced.map(l => l.radiusScale)).toEqual([.18, 1.34, 1]);
    expect(balanced[1].alphaScale).toBeCloseTo(.6);
    expect(balanced[2].spritecard?.params.m_flOverbrightFactor).toBeCloseTo(1.8);
    expect(balanced[2].spritecard?.params.m_vecTexturesInput).toBe(layers[2].spritecard?.params.m_vecTexturesInput);
    expect(balanced[2].colorMin).toBe(layers[2].colorMin);
    expect(JSON.stringify(layers)).toBe(before);
  });
  it('leaves incomplete, unrelated attachments and separate instances unchanged', () => {
    const layers = composition();
    for (const input of [layers.slice(0, 2), layers.slice(1), layers.map((l, i) => ({ ...l, attachment: String(i) })),
      layers.map((l, i) => ({ ...l, systemId: `root/${i}/0` }))]) {
      expect(balanceSpritePreviewComposition(input)).toEqual(input);
    }
  });
});
