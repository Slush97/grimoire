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
  it('keeps generated linear coverage gradients and converts authored UV degrees once', () => {
    const r = renderer(null);
    const inputs = r.params.m_vecTexturesInput as Array<Record<string, unknown>>;
    inputs[0].m_Gradient = { m_Stops: [{ m_flPosition: 0, m_Color: [153, 153, 153] }, { m_flPosition: 1, m_Color: [153, 153, 153] }] };
    inputs[0].m_TextureControls = { m_flFinalTextureUVRotation: 90 };
    const result = spritecardMaterial(r, '/', 'void main(){}')!;
    try {
      result.update(0);
      const texture = result.textures[0] as THREE.DataTexture;
      expect(texture.colorSpace).toBe(THREE.NoColorSpace);
      expect(Array.from(texture.image.data!.slice(0, 4))).toEqual([153, 153, 153, 255]);
      expect(result.material.uniforms.rot0.value).toBeCloseTo(Math.PI/2);
    } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
  });
  it('looks up RGBA ramps from covered color and preserves other supported ramp modes', () => {
    for (const channel of ['SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA', 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA', 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGB']) {
      const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
      const inputs = r.params.m_vecTexturesInput as Array<Record<string, unknown>>;
      inputs[1].m_nTextureType = 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP';
      inputs[1].m_nTextureChannels = channel;
      inputs[1].m_nTextureBlendMode = 'SPRITECARD_TEXTURE_BLEND_REPLACE';
      const result = spritecardMaterial(r, '/', 'void main(){}')!;
      try {
        expect(result.material.fragmentShader).toContain(channel === 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA'
          ? 'dot(gammaColor(accum.rgb*accum.a),vec3(.299,.587,.114))'
          : 'dot(gammaColor(accum.rgb),vec3(.299,.587,.114))');
      } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
    }
  });
  it('places only the atlas layer in its selected frame and clamps distorted resampling', () => {
    const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
    const inputs = r.params.m_vecTexturesInput as Array<Record<string, unknown>>;
    inputs[1].m_nTextureType = 'SPRITECARD_TEXTURE_UVDISTORTION';
    const result = spritecardMaterial(r, '/', 'void main(){}', true, true)!;
    try {
      const shader = result.material.fragmentShader;
      expect(shader).toContain('p0=placeUv(vCardUv,uv0,rot0)');
      expect(shader).toContain('p0=mix(vFrameRegion.xy,vFrameRegion.zw,p0)');
      expect(shader).toContain('p1=placeUv(vCardUv,uv1,rot1)');
      expect(shader).not.toContain('p1=mix(vFrameRegion');
      expect(shader).toContain('if(vFrameClamp>.5)warped1=clamp(warped1,vFrameRegion.xy,vFrameRegion.zw)');
    } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
  });
  it('applies authored additive self radiance after saturation without changing coverage', () => {
    const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
    r.params.m_flAddSelfAmount = 3;
    const result = spritecardMaterial(r, '/', 'void main(){}')!;
    try {
      expect(result.material.uniforms.addSelf.value).toBe(4);
      const shader = result.material.fragmentShader;
      expect(shader.indexOf('rgb*=addSelf;')).toBeGreaterThan(shader.indexOf('rgb=clamp(rgb,0.0,1.0);'));
      expect(shader).toContain('float alpha=smoothstep(0.0,1.0,accum.a)*vAlpha;');
    } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
  });
  it('keeps lookup RGB-alpha inside the incoming radial coverage and accepts a fifth RGB-only additive glow', () => {
    const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
    const inputs = r.params.m_vecTexturesInput as Array<Record<string, unknown>>;
    inputs.push({ ...inputs[0], m_nTextureType: 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP',
      m_nTextureChannels: 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA', m_nTextureBlendMode: 'SPRITECARD_TEXTURE_BLEND_REPLACE' });
    inputs.push({ ...inputs[0] }, { ...inputs[0], m_nTextureChannels: 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGB',
      m_nTextureBlendMode: 'SPRITECARD_TEXTURE_BLEND_ADD' });
    const result = spritecardMaterial(r, '/', 'void main(){}')!;
    try {
      expect(result.textures).toHaveLength(5);
      const shader = result.material.fragmentShader;
      expect(shader).toContain('t2.a=t2.a*dot(t2.rgb,vec3(.299,.587,.114));');
      expect(shader).toContain('t4.a=0.0;');
      expect(shader).toContain('accum+t4');
      expect(result.material.userData.previewBloom).toBe(true);
    } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
  });
  it('preserves RGB when subtracting an alpha-only erosion mask and keeps mirrored UVs', () => {
    const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
    r.params.m_flSelfIllumAmount = .9;
    const inputs = r.params.m_vecTexturesInput as Array<Record<string, unknown>>;
    inputs[0].m_nTextureChannels = inputs[1].m_nTextureChannels = 'SPRITECARD_TEXTURE_CHANNEL_MIX_A';
    inputs[1].m_nTextureBlendMode = 'SPRITECARD_TEXTURE_BLEND_SUBTRACT';
    inputs[0].m_TextureControls = { m_flFinalTextureScaleU: -1 };
    const result = spritecardMaterial(r, '/', 'void main(){}')!;
    try {
      expect(result.material.fragmentShader).toContain('t1=vec4(vec3(0.0),t1.a)');
      expect(result.material.fragmentShader).toContain('t0=vec4(vec3(1.0),t0.a)');
      expect(result.material.fragmentShader).toContain('accum-t1');
      result.update(0); expect(result.material.uniforms.uv0.value.x).toBe(-1);
      expect(result.material.uniforms.overbright.value).toBe(18);
    } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
  });
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
  it('keeps empty authored gradients white and clamps generated ramps', () => {
    const r = renderer(null);
    const inputs = r.params.m_vecTexturesInput as Array<Record<string, unknown>>;
    inputs[0].m_Gradient = { m_Stops: [] };
    const result = spritecardMaterial(r, '/', 'void main(){}')!;
    try {
      expect(result).not.toBeNull();
      expect((result.textures[0] as THREE.DataTexture).image.data?.slice(0, 4)).toEqual(new Uint8Array([255, 255, 255, 255]));
      for (const texture of result.textures) {
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
      }
    } finally { result.material.dispose(); result.textures.forEach(t => t.dispose()); }
  });
  it('omits unsupported material inputs rather than substituting a flat glow', () => {
    const r = renderer('PARTICLE_OUTPUT_BLEND_MODE_ADD');
    (r.params.m_vecTexturesInput as Array<Record<string, unknown>>)[1].m_nTextureType = 'SPRITECARD_TEXTURE_ANIMMOTIONVEC';
    expect(spritecardMaterial(r, '/', 'void main(){}')).toBeNull();
  });
});
