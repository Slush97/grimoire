import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  NPR_FRAGMENT,
  NPR_PATCH_MAP,
  OUTLINE_DEFAULT_THICKNESS,
  OUTLINE_MAX_THICKNESS,
  OUTLINE_MIN_THICKNESS,
  applySource2MaterialHints,
  buildOutlineShell,
  detailLayer,
  glassTransmissionTexture,
  hasDynamicAlphaOverride,
  highlightLayer,
  isTrueGlassMaterial,
  outlineParams,
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

describe('NPR_FRAGMENT vertex colors', () => {
  it('applies Three vertex colors before tint and CSB', () => {
    const colorGuard = '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )';
    const colorMultiply = 'csm_DiffuseColor *= vColor;';
    const tintMix = 'csm_DiffuseColor.rgb = mix';
    const csbApply = 'applyAlbedoCSB(csm_DiffuseColor.rgb, uAlbedoCSB)';

    expect(NPR_FRAGMENT).toContain(colorGuard);
    expect(NPR_FRAGMENT).toContain(colorMultiply);

    expect(NPR_FRAGMENT.indexOf(colorGuard)).toBeLessThan(NPR_FRAGMENT.indexOf(tintMix));
    expect(NPR_FRAGMENT.indexOf(colorMultiply)).toBeLessThan(NPR_FRAGMENT.indexOf(csbApply));
  });

  it('gates the vertex-color multiply on uApplyVertexColor (mask-only COLOR_0 is left alone)', () => {
    // GLTFLoader turns USE_COLOR on for any mesh with a COLOR_0 attribute, but a
    // tint-mask COLOR_0 (often (0,0,0)) must not multiply the albedo - that blacks
    // out Celeste's dress. The multiply has to be conditioned on the uniform.
    expect(NPR_FRAGMENT).toContain('if (uApplyVertexColor > 0.5) csm_DiffuseColor *= vColor;');
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
    expect(NPR_FRAGMENT).toContain('uniform float uHasHighlight;');
    expect(NPR_FRAGMENT).toContain('uniform vec3  uHighlightPositionSource;');
    expect(NPR_FRAGMENT).toContain('varying vec3 vNprSourcePosition;');
    expect(typeof fragmentPatch === 'string' ? fragmentPatch : '').toContain(
      'distance(vNprSourcePosition, uHighlightPositionSource)'
    );
    expect(NPR_FRAGMENT).not.toContain('vNprWorldPosition');
    expect(NPR_FRAGMENT).not.toContain('uHighlightPositionWs');
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

describe('outlineParams (F8)', () => {
  function morphic(overrides: Partial<MorphicExtras> = {}): MorphicExtras {
    return { shader: 'pbr.vfx', ...overrides };
  }

  it('disables when no g_vSolidOutlineTint is authored', () => {
    const p = outlineParams(morphic());
    expect(p.enabled).toBe(false);
    expect(p.reason).toBe('no-outline-tint');
  });

  it('disables when F_DISABLE_NPR_OUTLINE is set, keeping the authored tint readable', () => {
    const p = outlineParams(
      morphic({
        vectors: { g_vSolidOutlineTint: [0.1, 0.2, 0.3, 1] },
        ints: { F_DISABLE_NPR_OUTLINE: 1 },
      })
    );
    expect(p.enabled).toBe(false);
    expect(p.reason).toBe('disabled-flag');
    expect(p.tint.r).toBeCloseTo(0.1);
  });

  it('combines outline tint + additive when enabled', () => {
    const p = outlineParams(
      morphic({
        vectors: {
          g_vSolidOutlineTint: [0.1, 0.2, 0.3, 1],
          g_vSolidOutlineAdditive: [0.05, 0, 0.1, 0],
        },
      })
    );
    expect(p.enabled).toBe(true);
    expect(p.reason).toBe('');
    expect(p.tint.r).toBeCloseTo(0.15);
    expect(p.tint.b).toBeCloseTo(0.4);
  });

  it('defaults thickness when unauthored', () => {
    const p = outlineParams(morphic({ vectors: { g_vSolidOutlineTint: [1, 1, 1, 1] } }));
    expect(p.thickness).toBe(OUTLINE_DEFAULT_THICKNESS);
  });

  it('clamps a pathological large thickness to the safe max (no detached shell)', () => {
    const p = outlineParams(
      morphic({
        vectors: { g_vSolidOutlineTint: [1, 1, 1, 1] },
        floats: { g_flOverrideNprOutlineThickness: 5 },
      })
    );
    expect(p.thickness).toBe(OUTLINE_MAX_THICKNESS);
  });

  it('clamps a sub-pixel thickness up to the safe min', () => {
    const p = outlineParams(
      morphic({
        vectors: { g_vSolidOutlineTint: [1, 1, 1, 1] },
        floats: { g_flOverrideNprOutlineThickness: 0.00001 },
      })
    );
    expect(p.thickness).toBe(OUTLINE_MIN_THICKNESS);
  });
});

describe('buildOutlineShell (F8)', () => {
  function outlineMesh(morphic: MorphicExtras): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial();
    mat.userData = { morphic };
    return new THREE.Mesh(new THREE.BoxGeometry(), mat);
  }

  it('returns null when the material is not outline-eligible', () => {
    expect(buildOutlineShell(outlineMesh({ shader: 'pbr.vfx' }))).toBeNull();
  });

  it('returns null when F_DISABLE_NPR_OUTLINE opts out', () => {
    const mesh = outlineMesh({
      shader: 'pbr.vfx',
      vectors: { g_vSolidOutlineTint: [1, 1, 1, 1] },
      ints: { F_DISABLE_NPR_OUTLINE: 1 },
    });
    expect(buildOutlineShell(mesh)).toBeNull();
  });

  it('adds a shell child for an eligible mesh and removes it on teardown', () => {
    const mesh = outlineMesh({ shader: 'pbr.vfx', vectors: { g_vSolidOutlineTint: [1, 1, 1, 1] } });
    expect(mesh.children).toHaveLength(0);

    const dispose = buildOutlineShell(mesh);
    expect(dispose).toBeTypeOf('function');
    expect(mesh.children).toHaveLength(1);

    dispose!();
    expect(mesh.children).toHaveLength(0);
  });

  it('shares the mesh geometry with the shell (disposes only its own material)', () => {
    const mesh = outlineMesh({ shader: 'pbr.vfx', vectors: { g_vSolidOutlineTint: [1, 1, 1, 1] } });
    const dispose = buildOutlineShell(mesh)!;
    const shell = mesh.children[0] as THREE.Mesh;
    expect(shell.geometry).toBe(mesh.geometry);
    dispose();
  });
});

describe('NPR rim mask (F8)', () => {
  it('drives the rim strength from the tint/rim mask GREEN channel', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
    expect(patch).toContain('nprMask.g : uRimMaskDefault');
    expect(patch).toContain('uRimColor * nprRim');
  });
});

describe('NPR self-illum hue-preserving cap', () => {
  it('caps the self-illum additive by its peak channel so a bright tint keeps its hue', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
    expect(patch).toContain('float siPeak = max(max(siAdd.r, siAdd.g), siAdd.b);');
    expect(patch).toContain('siAdd *= uSelfIllumCap / siPeak;');
  });

  it('boosts self-illum tint chroma so a pale tint does not read white', () => {
    const patch = NPR_PATCH_MAP['*']['#include <opaque_fragment>'] as string;
    expect(patch).toContain('mix(vec3(siLuma), siColor, uSelfIllumSat)');
  });
});
