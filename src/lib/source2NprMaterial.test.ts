import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import {
  NPR_FRAGMENT,
  NPR_PATCH_MAP,
  NPR_VERTEX,
  applySource2MaterialHints,
  citadelColorUniforms,
  configureCitadelGlassPass,
  detailLayer,
  glassTransmissionTexture,
  hasDynamicAlphaOverride,
  highlightLayer,
  isTrueGlassMaterial,
  translucentAlphaTexture,
  wrapMaterialWithNpr,
} from './source2NprMaterial';
import type { MorphicDynamicExpr, MorphicExtras } from './source2NprMaterial';

function texture(width: number, height = width): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(width * height * 4).fill(255), width, height);
  tex.needsUpdate = true;
  return tex;
}

function dynamicExpr(source = '1.0'): MorphicDynamicExpr {
  return {
    source,
    decompiled: true,
    byte_len: 4,
    attributes: [],
    hash: 'test',
  };
}

describe('Authored glass sampling', () => {
  it('suppresses only the glass backface feedback pass while retaining the two-sided main draw', () => {
    const material = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
    const uniforms = citadelColorUniforms({ shader: 'pbr.vfx', ints: { F_GLASS: 1 }, floats: { g_flCloakBlurAmount: 0 } } as MorphicExtras);
    const previous = vi.fn();
    material.onBeforeRender = previous;
    configureCitadelGlassPass(material, uniforms);
    const render = () => material.onBeforeRender(null!, null!, null!, null!, null!, null!);
    render();
    expect(uniforms.uCitadelGlassBackfacePass.value).toBe(0);
    material.side = THREE.BackSide;
    render();
    expect(uniforms.uCitadelGlassBackfacePass.value).toBe(1);
    material.side = THREE.DoubleSide;
    render();
    expect(uniforms.uCitadelGlassBackfacePass.value).toBe(0);
    expect(previous).toHaveBeenCalledTimes(3);
    expect(NPR_FRAGMENT).toContain('if (uCitadelGlassBackfacePass > 0.5) discard;');
  });
  it('uses authored screen blur independently of specular roughness and retains dynamic fallback', () => {
    const morphic = { shader: 'pbr.vfx', ints: { F_GLASS: 1 }, floats: { g_flCloakBlurAmount: 0.007 } } as MorphicExtras;
    const uniforms = citadelColorUniforms(morphic);
    expect(uniforms.uCitadelGlass.value).toBe(1);
    expect(uniforms.uCitadelGlassBlur.value.toArray()).toEqual([0.007, 1, 1]);
    expect(citadelColorUniforms({ ...morphic, dynamic_params: { g_flCloakBlurAmount: dynamicExpr() } }).uCitadelGlass.value).toBe(0);
    expect(citadelColorUniforms({ ...morphic, ints: { F_GLASS: 0 } }).uCitadelGlass.value).toBe(0);
  });

  it('point-samples the decoded Citadel glass kernel without leaking across screen edges', () => {
    const patch = NPR_PATCH_MAP['*']['vec4 transmitted = getIBLVolumeRefraction('] as { value: string };
    const offsets = [...patch.value.matchAll(/vec2\((-?\d+\.\d+), (-?\d+\.\d+)\)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    expect(offsets).toHaveLength(8);
    expect(offsets[0]).toEqual([-0.0876, 0.9703]);
    expect(offsets[7]).toEqual([0.6384, -0.4054]);
    expect(offsets.every(([x, y]) => x * x + y * y <= 1)).toBe(true);
    expect(patch.value).toContain('glassScene /= 9.0;');
    expect(patch.value).toContain('texelFetch(transmissionSamplerMap, glassPixel, 0)');
    expect(patch.value).toContain('clamp(ivec2(tapUv * vec2(glassSize)), ivec2(0), glassSize - 1)');
    expect(patch.value).not.toContain('getTransmissionSample(');
    expect(patch.value).toContain('transmitted = getIBLVolumeRefraction(');
  });

  it('applies the second coverage factor and removes transmitted metallic color', () => {
    const patch = NPR_PATCH_MAP['*']['vec4 transmitted = getIBLVolumeRefraction('] as { value: string };
    const expression = patch.value.match(/transmitted.rgb = ([^;]+);/)![1];
    const evaluate = new Function('glassScene', 'glassAbsorption', 'metalnessFactor', 'material', `return ${expression};`);
    const transmitted = (coverage: number, metalness: number) => coverage * evaluate(
      { rgb: 0.8 }, 0.5, metalness, { transmission: coverage },
    ) as number;
    expect(transmitted(1, 0)).toBeCloseTo(0.4);
    expect(transmitted(0.5, 0)).toBeCloseTo(0.1);
    expect(transmitted(0, 0)).toBe(0);
    expect(transmitted(1, 1)).toBe(0);
  });
});

describe('NPR_FRAGMENT vertex colors', () => {
  it('places authored vertex tint on the correct side of CSB and preserves alpha separately', () => {
    const colorGuard = '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )';
    const before = 'if (uApplyVertexColor > 0.5 && uVertexColorBeforeCsb > 0.5)';
    const after = 'if (uApplyVertexColor > 0.5 && uVertexColorBeforeCsb <= 0.5)';
    const csbApply = 'applyAlbedoCSB(csm_DiffuseColor.rgb, uAlbedoCSB, uAlbedoReflectivity)';

    expect(NPR_FRAGMENT).toContain(colorGuard);
    expect(NPR_FRAGMENT.indexOf(before)).toBeLessThan(NPR_FRAGMENT.indexOf(csbApply));
    expect(NPR_FRAGMENT.indexOf(after)).toBeGreaterThan(NPR_FRAGMENT.indexOf(csbApply));
    expect(NPR_FRAGMENT).toContain('(uMaskVertexColor > 0.5 ? nprMask.r : 1.0) * uVertexColorStrength');
    expect(NPR_FRAGMENT).toContain('csm_DiffuseColor.a *= vColor.a');
    expect(NPR_FRAGMENT).not.toContain('csm_DiffuseColor *= vColor;');
  });

  it('gates the vertex-color multiply on uApplyVertexColor (mask-only COLOR_0 is left alone)', () => {
    // GLTFLoader turns USE_COLOR on for any mesh with a COLOR_0 attribute, but a
    // tint-mask COLOR_0 (often (0,0,0)) must not multiply the albedo - that blacks
    // out Celeste's dress. The multiply has to be conditioned on the uniform.
    expect(NPR_FRAGMENT).toContain('if (uApplyVertexColor > 0.5 && uVertexColorBeforeCsb > 0.5)');
    expect(NPR_FRAGMENT).toContain('if (uApplyVertexColor > 0.5 && uVertexColorBeforeCsb <= 0.5)');
  });
});

describe('Preview diffuse lighting bands', () => {
  const patch = NPR_PATCH_MAP['*']['#include <lights_fragment_end>'] as { value: string };
  const light = patch.value.match(/float nprLightLum = ([^;]+);/)![1];
  const quantized = patch.value.match(/float nprDirectQ = ([^;]+);/)![1];
  const scale = patch.value.match(/nprDirectLum > 1e-4 \? ([^\n]+) : 1.0/)![1];
  const evaluate = new Function('nprDirectLum', 'nprAlbedoLum', 'max', 'clamp', 'celQuantize', `
    const uBands = 4, uStepSharpness = 0.08;
    const nprLightLum = ${light};
    const nprDirectQ = ${quantized};
    return nprDirectLum > 1e-4 ? ${scale} : 1;
  `);
  const factor = (albedo: number, illumination: number) => evaluate(
    albedo * illumination, albedo, Math.max,
    (value: number, low: number, high: number) => Math.min(high, Math.max(low, value)),
    (value: number, bands: number) => Math.round(value * bands) / bands,
  ) as number;

  it('gives dark and pale diffuse surfaces the same band under equal lighting', () => {
    expect(factor(0.02, 0.22)).toBeCloseTo(factor(0.8, 0.22));
    expect(factor(0.02, 0.22)).toBeCloseTo(0.25 / 0.22);
  });

  it('keeps black and unlit surfaces finite without adding diffuse light', () => {
    expect(factor(0, 0.22)).toBe(1);
    expect(factor(0.8, 0)).toBe(1);
    expect(factor(1e-8, 0.22)).toBe(1);
  });
});

describe('Citadel near-black specular rule', () => {
  const patch = NPR_PATCH_MAP['*']['#include <lights_fragment_end>'] as { value: string };
  // Evaluate the actual shader expression, rather than duplicating its formula.
  const expression = patch.value.match(/float citadelSpecularFactor = ([^;]+);/)![1];
  it.each([0, 1])('suppresses black and dark specular while preserving brighter material with metalness=%s', (metalness) => {
    const evaluate = new Function('diffuseColor', 'max', 'clamp', `return (${expression});`);
    const factor = (albedo: number) => evaluate(
      { r: albedo, g: albedo, b: albedo }, Math.max,
      (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
    ) as number;
    const specular = metalness ? 0.02 : 0.04;
    expect(specular * factor(0)).toBe(0);
    expect(specular * factor(0.02)).toBeCloseTo(specular / 2);
    expect(specular * factor(0.04)).toBe(specular);
    expect(specular * factor(0.8)).toBe(specular);
    expect(patch.value).toContain('if (uCitadelSpecular > 0.5)');
    expect(patch.value).toContain('reflectedLight.directSpecular *= citadelSpecularFactor;');
    expect(patch.value).toContain('reflectedLight.indirectSpecular *= citadelSpecularFactor;');
  });
  it('disables both specular paths only at authored full roughness when opted in', () => {
    const condition = patch.value.match(/if \((uNoSpecularAtFullRoughness[^)]+)\)/)![1];
    const evaluate = new Function('uNoSpecularAtFullRoughness', 'roughnessFactor', `return (${condition});`);
    const active = (flag: number, roughness: number) => evaluate(flag, roughness) as boolean;
    expect(active(1, 1)).toBe(true);
    expect(active(1, 0.999)).toBe(false);
    expect(active(0, 1)).toBe(false);
    expect(patch.value).toContain('reflectedLight.directSpecular = vec3(0.0);');
    expect(patch.value).toContain('reflectedLight.indirectSpecular = vec3(0.0);');
  });
});

describe('detailLayer', () => {
  function morphic(overrides: Partial<MorphicExtras> = {}): MorphicExtras {
    return {
      shader: 'pbr.vfx',
      ...overrides,
      ints: { F_DETAIL: 1, ...overrides.ints },
      resolvedTextures: { g_tDetail: texture(8), ...overrides.resolvedTextures },
    };
  }

  it('enables authored real detail textures with identity defaults', () => {
    const detail = detailLayer(morphic());

    expect(detail.has).toBe(1);
    expect(detail.texture).toBeTruthy();
    expect(detail.blendFactor).toBe(1);
    expect(detail.blendMode).toBe(0);
    expect(detail.uvScale.toArray()).toEqual([1, 1]);
    expect(detail.uvOffset.toArray()).toEqual([0, 0]);
  });

  it('keeps placeholder detail textures disabled', () => {
    const detail = detailLayer(morphic({ resolvedTextures: { g_tDetail: texture(4) } }));

    expect(detail.has).toBe(0);
    expect(detail.texture).toBeNull();
    expect(detail.blendFactor).toBe(0);
  });

  it('keeps zero blend detail disabled even when F_DETAIL is set', () => {
    const detail = detailLayer(morphic({ floats: { g_flDetailBlendFactor1: 0 } }));

    expect(detail.has).toBe(0);
    expect(detail.texture).toBeNull();
  });

  it('accepts scalar-authored detail and preserves transform uniforms', () => {
    const detail = detailLayer(
      morphic({
        ints: { F_DETAIL: 0, g_nDetailBlendMode: 2 },
        floats: { g_flDetailBlendFactor1: 0.4, g_flDetailTexCoordRotation1: 0.25 },
        vectors: {
          g_vDetailColorTint1: [0.7, 0.8, 0.9, 1],
          g_vDetailTexCoordOffset1: [0.1, 0.2, 0, 0],
          g_vDetailTexCoordScale1: [3, 4, 0, 0],
        },
      })
    );

    expect(detail.has).toBe(1);
    expect(detail.blendFactor).toBe(0.4);
    expect(detail.blendMode).toBe(2);
    expect(detail.tint.toArray()).toEqual([0.7, 0.8, 0.9]);
    expect(detail.uvOffset.toArray()).toEqual([0.1, 0.2]);
    expect(detail.uvScale.toArray()).toEqual([3, 4]);
    expect(detail.uvRotation).toBe(0.25);
    expect(detail.uvChannel).toBe(0);
  });

  it('disables secondary-UV detail until USE_UV2 can be proven safe', () => {
    const detail = detailLayer(morphic({ ints: { g_bUseSecondaryUvForDetail1: 1 } }));

    expect(detail.has).toBe(0);
    expect(detail.texture).toBeNull();
    expect(detail.blendFactor).toBe(0);
    expect(detail.uvChannel).toBe(0);
  });

  it.each([
    ['dynamic blend factor', { dynamic_params: { g_flDetailBlendFactor1: dynamicExpr('0.5') } }],
    ['dynamic detail texture', { dynamic_texture_params: { g_tDetail: dynamicExpr('texture') } }],
    ['dynamic transform', { dynamic_params: { g_vDetailTexCoordScale1: dynamicExpr('float2(2, 2)') } }],
  ])('disables static detail when %s overrides are present', (_name, overrides) => {
    const detail = detailLayer(morphic(overrides));

    expect(detail.has).toBe(0);
    expect(detail.texture).toBeNull();
    expect(detail.blendFactor).toBe(0);
  });
});

describe('highlightLayer', () => {
  function morphic(overrides: Partial<MorphicExtras> = {}): MorphicExtras {
    return {
      shader: 'pbr.vfx',
      ...overrides,
      floats: { ...overrides.floats },
      vectors: { ...overrides.vectors },
    };
  }

  it('keeps missing default highlight params disabled', () => {
    const highlight = highlightLayer(morphic());

    expect(highlight.has).toBe(0);
    expect(highlight.tint.toArray()).toEqual([0, 0, 0]);
    expect(highlight.coverage).toBe(0);
    expect(highlight.radius).toBe(0);
  });

  it('keeps Haze-like tint with zero coverage and hardness disabled', () => {
    const highlight = highlightLayer(
      morphic({
        floats: {
          g_flHighlightCoverage1: 0,
          g_flHighlightHardness1: 0,
          g_flHighlightRadius1: 64,
        },
        vectors: {
          g_vHighlightTint1: [0.2, 0.8, 1.4, 1],
          g_vHighlightPositionWs1: [1, 2, 3, 0],
        },
      })
    );

    expect(highlight.has).toBe(0);
    expect(highlight.brightness).toBe(0);
  });

  it('enables complete static meaningful highlight params', () => {
    const highlight = highlightLayer(
      morphic({
        floats: {
          g_flHighlightCoverage1: 0.45,
          g_flHighlightHardness1: 0.75,
          g_flHighlightTintBrightness1: 1.25,
          g_flInvertHighlight1: 1,
          g_flHighlightRadius1: 120,
        },
        vectors: {
          g_vHighlightTint1: [0.9, 0.4, 0.2, 1],
          g_vHighlightPositionWs1: [10, 20, 30, 0],
        },
      })
    );

    expect(highlight.has).toBe(1);
    expect(highlight.tint.toArray()).toEqual([0.9, 0.4, 0.2]);
    expect(highlight.coverage).toBe(0.45);
    expect(highlight.hardness).toBe(0.75);
    expect(highlight.brightness).toBe(1.25);
    expect(highlight.invert).toBe(1);
    expect(highlight.positionSource.toArray()).toEqual([10, 20, 30]);
    expect(highlight.radius).toBe(120);
  });

  it.each([
    ['coverage', { dynamic_params: { g_flHighlightCoverage1: dynamicExpr('0.5') } }],
    ['tint', { dynamic_params: { g_vHighlightTint1: dynamicExpr('float3(1, 0, 0)') } }],
    ['position', { dynamic_params: { g_vHighlightPositionWs1: dynamicExpr('float3(0, 0, 0)') } }],
    ['sphere alias', { dynamic_params: { g_vHighlightSphere1: dynamicExpr('float4(0, 0, 0, 64)') } }],
    ['normal strength', { dynamic_params: { g_flHighlightNormalStrength1: dynamicExpr('64') } }],
    ['code tint coverage', { dynamic_params: { TintCoverage: dynamicExpr('0.5') } }],
    ['code tint hardness', { dynamic_params: { TintHardness: dynamicExpr('0.5') } }],
    ['code tint brightness', { dynamic_params: { TintBrightness: dynamicExpr('1.0') } }],
    ['code tint color', { dynamic_params: { TintColor: dynamicExpr('float3(1, 1, 1)') } }],
    ['code tint sphere', { dynamic_params: { TintSphere: dynamicExpr('float4(0, 0, 0, 64)') } }],
  ])('fails closed when a dynamic %s override is present', (_name, overrides) => {
    const highlight = highlightLayer(
      morphic({
        floats: {
          g_flHighlightCoverage1: 0.5,
          g_flHighlightRadius1: 80,
        },
        vectors: {
          g_vHighlightTint1: [1, 0.5, 0.25, 1],
          g_vHighlightPositionWs1: [1, 2, 3, 0],
        },
        ...overrides,
      })
    );

    expect(highlight.has).toBe(0);
    expect(highlight.radius).toBe(0);
  });

  it('captures source-space highlight GLSL after skinning and displacement, before model transforms', () => {
    const patch = NPR_PATCH_MAP['*']['#include <displacementmap_vertex>'];
    const fragmentPatch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'];

    expect(typeof patch).toBe('object');
    expect(patch).toMatchObject({ type: 'vs' });
    expect(typeof fragmentPatch).toBe('string');
    expect(NPR_PATCH_MAP['*']['#include <worldpos_vertex>']).toBeUndefined();
    expect(typeof patch === 'object' ? patch.value : '').toContain('#include <displacementmap_vertex>');
    expect(typeof patch === 'object' ? patch.value : '').toContain('vNprSourcePosition = transformed;');
    expect(typeof patch === 'object' ? patch.value : '').not.toContain('modelMatrix');
    expect(NPR_VERTEX).toContain('uniform float uHasJitter;');
    expect(NPR_VERTEX).toContain('uniform sampler2D uJitterMap;');
    expect(NPR_VERTEX).toContain('uniform float uJitterStrength;');
    expect(NPR_FRAGMENT).toContain('uniform float uHasHighlight;');
    expect(NPR_FRAGMENT).toContain('uniform vec3  uHighlightPositionSource;');
    expect(NPR_FRAGMENT).toContain('varying vec3 vNprSourcePosition;');
    expect(typeof fragmentPatch === 'string' ? fragmentPatch : '').toContain(
      'distance(vNprSourcePosition, uHighlightPositionSource)'
    );
    expect(NPR_FRAGMENT).not.toContain('vNprWorldPosition');
    expect(NPR_FRAGMENT).not.toContain('uHighlightPositionWs');
  });

  it('owns a tint-mask clone without disposing the shared resolved sampler', () => {
    const shared = texture(8);
    const disposed = vi.spyOn(shared, 'dispose');
    const base = new THREE.MeshStandardMaterial();
    base.userData.morphic = morphic({ ints: { F_USE_NPR_LIGHTING: 1 }, resolvedTextures: { g_tTintMaskRimLightMask: shared } });
    const result = wrapMaterialWithNpr(base)!;
    expect(result.uniforms.uTintRimMask.value).not.toBe(shared);
    expect(result.ownedTextures).toContain(result.uniforms.uTintRimMask.value);
    result.ownedTextures.forEach((t) => t.dispose());
    result.material.dispose();
    expect(disposed).not.toHaveBeenCalled();
  });

  it('keeps legacy wrapper highlight uniforms identity even with authored F6 params', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0xffffff });
    base.userData = {
      morphic: morphic({
        ints: { F_USE_NPR_LIGHTING: 1 },
        floats: {
          g_flHighlightCoverage1: 0.5,
          g_flHighlightRadius1: 80,
        },
        vectors: {
          g_vHighlightTint1: [1, 0.5, 0.25, 1],
          g_vHighlightPositionWs1: [1, 2, 3, 0],
        },
      }),
    };

    const result = wrapMaterialWithNpr(base);

    expect(result).not.toBeNull();
    expect(result?.uniforms.uHasHighlight.value).toBe(0);
    expect(result?.uniforms.uHighlightPositionSource.value.toArray()).toEqual([0, 0, 0]);
    expect(result?.uniforms.uHighlightRadius.value).toBe(0);
    result?.material.dispose();
  });
});

describe('glass and alpha material helpers', () => {
  function morphic(overrides: Partial<MorphicExtras> = {}): MorphicExtras {
    return {
      shader: 'pbr.vfx',
      ...overrides,
      ints: { ...overrides.ints },
      floats: { ...overrides.floats },
      resolvedTextures: { ...overrides.resolvedTextures },
    };
  }

  it('detects shader glass and rejects placeholder transmission masks', () => {
    const glass = morphic({
      shader: 'hero_glass.vfx',
      resolvedTextures: {
        g_tGlass: texture(4),
      },
    });

    expect(isTrueGlassMaterial(glass)).toBe(true);
    expect(glassTransmissionTexture(glass)).toBeNull();
  });

  it('lets explicit alpha state override physical transmission fallback', () => {
    const inheritedGlass = texture(16);
    const physical = new THREE.MeshPhysicalMaterial({
      transmission: 0.9,
      transmissionMap: inheritedGlass,
    });
    const alpha = morphic({
      blend_mode: 'blend_zwrite',
      ints: { F_TRANSLUCENT: 1 },
    });

    expect(isTrueGlassMaterial(alpha, physical)).toBe(false);
  });

  it('prefers real alt translucency over glass for alpha maps', () => {
    const alt = texture(16);
    const glass = texture(16);
    const alpha = translucentAlphaTexture(
      morphic({
        resolvedTextures: {
          g_tAltTranslucency: alt,
          g_tGlass: glass,
        },
      })
    );

    expect(alpha).toBe(alt);
  });

  it('fails closed for dynamic alpha texture overrides', () => {
    const alpha = morphic({
      resolvedTextures: {
        g_tAltTranslucency: texture(16),
      },
      dynamic_texture_params: {
        g_tAltTranslucency: dynamicExpr('texture'),
      },
    });

    expect(hasDynamicAlphaOverride(alpha)).toBe(true);
    expect(translucentAlphaTexture(alpha)).toBeNull();
  });
});

describe('applySource2MaterialHints glass and cloak state', () => {
  function sceneWithMaterial(material: THREE.Material): THREE.Scene {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    return scene;
  }

  it('binds true glass masks as physical transmission maps without alpha fading', () => {
    const glassMask = texture(16);
    const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff });
    material.userData = {
      morphic: {
        shader: 'pbr.vfx',
        ints: { F_GLASS: 1 },
        floats: { g_flIOR: 1.31 },
        resolvedTextures: { g_tGlass: glassMask },
      } satisfies MorphicExtras,
    };

    const result = applySource2MaterialHints(sceneWithMaterial(material));

    expect(material.transmission).toBeGreaterThan(0);
    expect(material.transmissionMap).toBe(glassMask);
    expect(material.ior).toBe(1.31);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);

    result.restore();
    expect(material.transmissionMap).toBeNull();
  });

  it('keeps physical translucent bases alpha-only and restores transmission state', () => {
    const inheritedGlass = texture(16);
    const alphaMask = texture(16);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.8,
      transmissionMap: inheritedGlass,
    });
    material.userData = {
      morphic: {
        shader: 'pbr.vfx',
        blend_mode: 'blend_zwrite',
        ints: { F_TRANSLUCENT: 1 },
        resolvedTextures: { g_tAltTranslucency: alphaMask },
      } satisfies MorphicExtras,
    };

    const result = applySource2MaterialHints(sceneWithMaterial(material));

    expect(result.stats.glass).toBe(0);
    expect(result.stats.translucent).toBe(1);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.alphaMap).toBe(alphaMask);
    expect(material.transmission).toBe(0);
    expect(material.transmissionMap).toBeNull();

    result.restore();
    expect(material.transmission).toBe(0.8);
    expect(material.transmissionMap).toBe(inheritedGlass);
    expect(material.alphaMap).toBeNull();
  });

  it.each([
    ['placeholder', {}, texture(4)],
    ['dynamic', { dynamic_texture_params: { g_tGlass: dynamicExpr('texture') } }, texture(16)],
  ])('clears inherited physical transmission maps for %s glass masks', (_name, overrides, glassMask) => {
    const inheritedGlass = texture(16);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.6,
      transmissionMap: inheritedGlass,
    });
    material.userData = {
      morphic: {
        shader: 'pbr.vfx',
        ints: { F_GLASS: 1 },
        resolvedTextures: { g_tGlass: glassMask },
        ...overrides,
      } satisfies MorphicExtras,
    };

    const result = applySource2MaterialHints(sceneWithMaterial(material));

    expect(result.stats.glass).toBe(1);
    expect(material.transmission).toBeGreaterThan(0);
    expect(material.transmissionMap).toBeNull();

    result.restore();
    expect(material.transmission).toBe(0.6);
    expect(material.transmissionMap).toBe(inheritedGlass);
  });

  it('does not attach physical transmission fields for standard F_GLASS in legacy hints', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    material.userData = {
      morphic: {
        shader: 'pbr.vfx',
        ints: { F_GLASS: 1 },
        resolvedTextures: { g_tGlass: texture(16) },
      } satisfies MorphicExtras,
    };

    const result = applySource2MaterialHints(sceneWithMaterial(material));

    expect(result.stats.glass).toBe(1);
    expect((material as Partial<THREE.MeshPhysicalMaterial>).transmission).toBeUndefined();
    expect((material as Partial<THREE.MeshPhysicalMaterial>).transmissionMap).toBeUndefined();

    result.restore();
    expect((material as Partial<THREE.MeshPhysicalMaterial>).transmission).toBeUndefined();
    expect((material as Partial<THREE.MeshPhysicalMaterial>).transmissionMap).toBeUndefined();
  });

  it('keeps cloak and refraction params metadata-only', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    material.userData = {
      morphic: {
        shader: 'pbr.vfx',
        floats: {
          g_flCloakFactor: 1,
          g_flCloakNoiseScale: 4,
          g_flRefractionBlur: 0.5,
        },
        resolvedTextures: {
          g_tGlass: texture(16),
        },
      } satisfies MorphicExtras,
    };

    const result = applySource2MaterialHints(sceneWithMaterial(material));

    expect(result.stats.glass).toBe(0);
    expect(result.stats.translucent).toBe(0);
    expect(result.stats.alphaMaps).toBe(0);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.alphaMap).toBeNull();
    expect((material as THREE.MeshPhysicalMaterial).transmissionMap).toBeUndefined();
    result.restore();
  });

  it('fails closed for dynamic alpha overrides in the legacy hint path', () => {
    const alphaMask = texture(16);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      opacity: 0.4,
      alphaMap: alphaMask,
    });
    material.userData = {
      morphic: {
        shader: 'pbr.vfx',
        blend_mode: 'blend_zwrite',
        ints: { F_TRANSLUCENT: 1 },
        floats: { g_flOpacityScale1: 0.25 },
        resolvedTextures: { g_tAltTranslucency: alphaMask },
        dynamic_params: { g_flOpacityScale1: dynamicExpr('0.25') },
      } satisfies MorphicExtras,
    };

    const result = applySource2MaterialHints(sceneWithMaterial(material));

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.opacity).toBe(1);
    expect(material.alphaMap).toBeNull();
    expect(material.alphaTest).toBe(0);

    result.restore();
    expect(material.opacity).toBe(0.4);
    expect(material.alphaMap).toBe(alphaMask);
  });
});

describe('NPR rim mask (F8)', () => {
  it('retains the preview light/up/AO approximation for opaque cloth and the separate glass rim', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
    expect(patch).toContain('lightRim * upRamp * nprRimMaskG');
    expect(patch).toContain('clamp(ambientOcclusion, 0.0, 1.0)');
    expect(patch).toContain('uCitadelGlass > 0.5 ? 1.0 : opaqueRimAo');
    expect(patch).toContain('uCitadelGlass > 0.5 ? -dot(nprN, nprV) : dot(nprN, nprL)');
    expect(patch).not.toContain('nprFres * nprGate');
  });
  it('drives the rim strength from the tint/rim mask GREEN channel', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
    expect(patch).toContain('nprMask.g : uRimMaskDefault');
      expect(patch).toContain('nprRimTint * nprRim');
  });

    it('keeps transmitted scene color out of cel and uses lit surface color for the independent glass rim', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
    expect(patch).toContain('#ifdef USE_TRANSMISSION');
    expect(patch).toContain('1.0 - clamp(material.transmission, 0.0, 1.0)');
    expect(patch).toContain('mix(nprLit, nprLit *');
      expect(patch).not.toContain('uRimStrength * nprSurfaceWeight');
      expect(patch).toContain('reflectedLight.directDiffuse + reflectedLight.indirectDiffuse');
  });
});

describe('NPR self-illum hue-preserving cap', () => {
  it('caps the self-illum additive by its peak channel so a bright tint keeps its hue', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;

    expect(patch).toContain('float siPeak = max(max(siAdd.r, siAdd.g), siAdd.b);');
    expect(patch).toContain('siAdd *= uSelfIllumCap / siPeak;');
  });

  it('applies the dynamic self-illum pulse after the cap so the cap does not flatten it', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;

    expect(NPR_FRAGMENT).toContain('uniform float uSelfIllumPulse;');
    expect(patch.indexOf('siAdd *= uSelfIllumCap / siPeak;')).toBeLessThan(
      patch.indexOf('siAdd *= uSelfIllumPulse;')
    );
  });

  it('boosts self-illum tint chroma so a pale tint does not read white', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;

    expect(patch).toContain('mix(vec3(siLuma), siColor, uSelfIllumSat)');
  });

  it('routes self-illum through the post-opaque NPR output so it affects visible color', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;

    expect(NPR_FRAGMENT).not.toContain('csm_Emissive += siAdd;');
    expect(patch).toContain('uHasSelfIllum');
    expect(patch).toContain('nprOut += siAdd');
  });

  it('gates shaped self-illum to chromatic warm tattoo pixels, not the whole body mask', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;

    expect(patch).toContain('float baseChroma = baseMax - baseMin;');
    expect(patch).toContain('float baseWarmth = csm_DiffuseColor.r - max');
    expect(patch).toContain('float detailGate = smoothstep');
    expect(patch).toContain('float headRegion = smoothstep(70.0, 78.0, vNprSourcePosition.z)');
    expect(patch).toContain('rawSiMask * rawSiMask * 8192.0 * inkGate');
  });
});


describe('glass transmission shader integration', () => {
  it('applies authored scene blur after CSM expands the transmission chunk', () => {
    const material = new CustomShaderMaterial({
      baseMaterial: new THREE.MeshPhysicalMaterial({ transmission: 1 }),
      fragmentShader: NPR_FRAGMENT,
      patchMap: NPR_PATCH_MAP,
    });
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {},
    };
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain(
      'n, v, uGlassTransmissionRoughness >= 0.0 ? uGlassTransmissionRoughness : material.roughness,'
    );
    expect(shader.fragmentShader).not.toContain('n, v, material.roughness,');
    expect(shader.fragmentShader).toContain('if (uCitadelGlass > 0.5)');
    expect(shader.fragmentShader).toContain('max(dot(n, v), 0.01)');
    expect(shader.fragmentShader).toContain('(1.0 - metalnessFactor) * material.transmission');
    expect(shader.fragmentShader).toContain('if (glassRadius > 0.0) glassScene.rgb *= 12.0;');
    expect(shader.fragmentShader).toContain('uCitadelGlass > 0.5 ? max(material.roughness, 0.45) : material.roughness');
    expect(shader.fragmentShader).not.toContain('#include <lights_fragment_maps>');
    expect(shader.fragmentShader).toContain('material.attenuationDistance );\n      }');
    material.dispose();
  });
});

describe('NPR preview light coordinate space', () => {
  const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
  it('uses the final view-space mapped normal and transforms the world key once', () => {
    expect(patch).toContain('vec3 nprN = normal;');
    expect(patch).toContain('vec3 nprL = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);');
    expect(patch).not.toContain('vec3 nprN = normalize(vNormal)');
    expect(patch).not.toContain('vec3 nprL = normalize(uKeyDir)');
    // A direction has w=0, so camera translation must not affect the gate.
    expect(patch).not.toContain('vec4(uKeyDir, 1.0)');
  });
  it('keeps the light-normal gate invariant under camera orbit and translation', () => {
    const normalWorld = new THREE.Vector3(0.2, 0.8, 0.5).normalize();
    const lightWorld = new THREE.Vector3(3, 5, 4).normalize();
    const expected = normalWorld.dot(lightWorld);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(Math.sin(yaw) * 4, 2, Math.cos(yaw) * 4);
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const rotation = new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse);
      const normalView = normalWorld.clone().applyMatrix3(rotation).normalize();
      const lightView = lightWorld.clone().applyMatrix3(rotation).normalize();
      expect(normalView.dot(lightView)).toBeCloseTo(expected, 12);
      const upView = new THREE.Vector3(0, 1, 0).applyMatrix3(rotation).normalize();
      expect(normalView.dot(upView)).toBeCloseTo(normalWorld.y, 12);
    }
  });
});
