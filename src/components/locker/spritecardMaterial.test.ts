import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { spritecardMaterial } from './spritecardMaterial';
import type { FxRenderer } from './fxDescriptor';
const renderer = (blendMode: string | null): FxRenderer => ({ class: 'C_OP_RenderSprites', mode: 'sprite', blendMode, textures: [], params: {
  m_flSelfIllumAmount: 1, m_flDiffuseAmount: 0, m_flOverbrightFactor: 20,
  m_vecTexturesInput: [0, 1].map(() => ({ m_bReplaceTextureWithGradient: true,
    m_Gradient: { m_Stops: [{ m_flPosition: 0, m_Color: [0, 0, 0] }, { m_flPosition: 1, m_Color: [255, 255, 255] }] },
    m_TextureControls: { m_flFinalTextureOffsetV: { pf: 'PF_TYPE_COLLECTION_AGE', mult: .3 } } })),
} });
describe('shared authored spritecards', () => {
  it('preserves authored high radiance and normal-alpha versus additive composition', () => {
    for (const blend of [null, 'PARTICLE_OUTPUT_BLEND_MODE_ADD']) {
      const result = spritecardMaterial(renderer(blend), '/', 'void main(){}', true)!;
      try {
        expect(result.material.uniforms.overbright.value).toBe(20);
        expect(result.material.blending).toBe(blend ? THREE.CustomBlending : THREE.NormalBlending);
        result.update(2); expect(result.material.uniforms.uv0.value.w).toBeCloseTo(.6);
        expect(result.textures).toHaveLength(2);
        expect((result.textures[0] as THREE.DataTexture).image.data?.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 255]));
      } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
    }
  });
  it('omits unsupported material inputs rather than substituting a flat glow', () => {
    const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
    (r.params.m_vecTexturesInput as Array<Record<string, unknown>>)[1].m_nTextureType = 'SPRITECARD_TEXTURE_ANIMMOTIONVEC';
    expect(spritecardMaterial(r, '/', 'void main(){}')).toBeNull();
  });
});
