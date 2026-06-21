import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDeadlockMaterial } from './deadlockMaterial';
import { DEFAULT_NPR_TUNING } from './source2NprMaterial';
import type { MorphicDynamicExpr, MorphicExtras } from './source2NprMaterial';

function materialWithMorphic(morphic: MorphicExtras): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  material.userData = { morphic };
  return material;
}

function physicalMaterialWithMorphic(morphic: MorphicExtras): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff });
  material.userData = { morphic };
  return material;
}

function texture(width: number, height = width): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(width * height * 4).fill(255), width, height);
  tex.colorSpace = THREE.NoColorSpace;
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

describe('buildDeadlockMaterial vertex colors', () => {
  it.each(['F_VERTEX_COLOR', 'F_PAINT_VERTEX_COLORS'])(
    'enables Three vertex colors when %s requires COLOR_0',
    (flagName) => {
      const base = materialWithMorphic({
        shader: 'pbr.vfx',
        ints: {
          F_USE_NPR_LIGHTING: 1,
          [flagName]: 1,
        },
      });
      base.vertexColors = false;

      const result = buildDeadlockMaterial(base);

      expect(result.material.vertexColors).toBe(true);
      expect(base.vertexColors).toBe(false);
      result.dispose();
    }
  );

  it.each(['g_bMaskVertexColorTint1', 'g_bApplyTintToVertexColors'])(
    'does not infer Three vertex colors from %s alone',
    (flagName) => {
      const base = materialWithMorphic({
        shader: 'pbr.vfx',
        ints: {
          F_USE_NPR_LIGHTING: 1,
          [flagName]: 1,
        },
      });
      base.vertexColors = false;

      const result = buildDeadlockMaterial(base);

      expect(result.material.vertexColors).toBe(false);
      expect(base.vertexColors).toBe(false);
      result.dispose();
    }
  );

  it.each(['g_bMaskVertexColorTint1', 'g_bApplyTintToVertexColors'])(
    'preserves GLTFLoader-enabled vertex colors when %s is present',
    (flagName) => {
      const base = materialWithMorphic({
        shader: 'pbr.vfx',
        ints: {
          F_USE_NPR_LIGHTING: 1,
          [flagName]: 1,
        },
      });
      base.vertexColors = true;

      const result = buildDeadlockMaterial(base);

      expect(result.material.vertexColors).toBe(true);
      expect(base.vertexColors).toBe(true);
      result.dispose();
    }
  );

  it('leaves materials without a vertex-color requirement unchanged', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
    });
    base.vertexColors = false;

    const result = buildDeadlockMaterial(base);

    expect(result.material.vertexColors).toBe(false);
    expect(base.vertexColors).toBe(false);
    result.dispose();
  });

  it('preserves GLTFLoader-enabled vertex colors when no Source 2 flag is present', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
    });
    base.vertexColors = true;

    const result = buildDeadlockMaterial(base);

    expect(result.material.vertexColors).toBe(true);
    expect(base.vertexColors).toBe(true);
    result.dispose();
  });
});

describe('buildDeadlockMaterial detail textures', () => {
  it('binds real authored detail as an owned sRGB repeating texture', () => {
    const sourceDetail = texture(8);
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_DETAIL: 1,
        g_nDetailBlendMode: 2,
      },
      floats: {
        g_flDetailBlendFactor1: 0.35,
        g_flDetailTexCoordRotation1: 0.125,
      },
      vectors: {
        g_vDetailColorTint1: [0.8, 0.7, 0.6, 1],
        g_vDetailTexCoordOffset1: [0.25, 0.5, 0, 0],
        g_vDetailTexCoordScale1: [2, 3, 0, 0],
      },
      resolvedTextures: {
        g_tDetail: sourceDetail,
      },
    });

    const result = buildDeadlockMaterial(base);
    const detailMap = result.uniforms.uDetailMap.value as THREE.Texture;

    expect(result.uniforms.uHasDetail.value).toBe(1);
    expect(detailMap).not.toBe(sourceDetail);
    expect(detailMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(detailMap.wrapS).toBe(THREE.RepeatWrapping);
    expect(detailMap.wrapT).toBe(THREE.RepeatWrapping);
    expect(result.ownedTextures).toContain(detailMap);
    expect(result.uniforms.uDetailBlendFactor.value).toBe(0.35);
    expect(result.uniforms.uDetailBlendMode.value).toBe(2);
    expect(result.uniforms.uDetailTint.value.toArray()).toEqual([0.8, 0.7, 0.6]);
    expect(result.uniforms.uDetailUvOffset.value.toArray()).toEqual([0.25, 0.5]);
    expect(result.uniforms.uDetailUvScale.value.toArray()).toEqual([2, 3]);
    expect(result.uniforms.uDetailUvRotation.value).toBe(0.125);
    expect(result.uniforms.uDetailUvChannel.value).toBe(0);
    expect(sourceDetail.colorSpace).toBe(THREE.NoColorSpace);
    result.dispose();
  });

  it('disables secondary-UV detail rather than sampling primary UVs', () => {
    const sourceDetail = texture(8);
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_DETAIL: 1,
        g_bUseSecondaryUvForDetail1: 1,
      },
      resolvedTextures: {
        g_tDetail: sourceDetail,
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasDetail.value).toBe(0);
    expect(result.uniforms.uDetailBlendFactor.value).toBe(0);
    expect(result.uniforms.uDetailUvChannel.value).toBe(0);
    expect(result.ownedTextures).not.toContain(result.uniforms.uDetailMap.value as THREE.Texture);
    result.dispose();
  });

  it.each([
    ['dynamic blend factor', { dynamic_params: { g_flDetailBlendFactor1: dynamicExpr('0.5') } }],
    ['dynamic detail texture', { dynamic_texture_params: { g_tDetail: dynamicExpr('texture') } }],
    ['dynamic transform', { dynamic_params: { g_vDetailTexCoordOffset1: dynamicExpr('float2(0.25, 0.5)') } }],
  ])('disables static detail when %s overrides are present', (_name, overrides) => {
    const sourceDetail = texture(8);
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_DETAIL: 1,
      },
      resolvedTextures: {
        g_tDetail: sourceDetail,
      },
      ...overrides,
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasDetail.value).toBe(0);
    expect(result.uniforms.uDetailBlendFactor.value).toBe(0);
    expect(result.ownedTextures).not.toContain(result.uniforms.uDetailMap.value as THREE.Texture);
    result.dispose();
  });

  it('keeps placeholder detail textures disabled', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_DETAIL: 1,
      },
      resolvedTextures: {
        g_tDetail: texture(4),
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasDetail.value).toBe(0);
    expect(result.ownedTextures).not.toContain(result.uniforms.uDetailMap.value as THREE.Texture);
    result.dispose();
  });

  it('does not enable detail from texture presence alone', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
      resolvedTextures: {
        g_tDetail: texture(8),
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasDetail.value).toBe(0);
    result.dispose();
  });
});

describe('buildDeadlockMaterial glass and translucency state', () => {
  it('binds F_GLASS g_tGlass as an owned transmissionMap clone', () => {
    const sourceGlass = texture(16);
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_GLASS: 1,
      },
      floats: {
        g_flIOR: 1.27,
      },
      resolvedTextures: {
        g_tGlass: sourceGlass,
      },
    });

    const result = buildDeadlockMaterial(base);
    const material = result.material as THREE.MeshPhysicalMaterial;
    const transmissionMap = material.transmissionMap;

    expect(material.isMeshPhysicalMaterial).toBe(true);
    expect(material.transmission).toBeGreaterThan(0);
    expect(material.ior).toBe(1.27);
    expect(transmissionMap).toBeTruthy();
    expect(transmissionMap).not.toBe(sourceGlass);
    expect(transmissionMap?.image).toBe(sourceGlass.image);
    expect(sourceGlass.colorSpace).toBe(THREE.NoColorSpace);
    expect(result.ownedTextures).toContain(transmissionMap);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    result.dispose();
  });

  it('uses g_tAltTranslucency as an alphaMap for blend_zwrite without transmission', () => {
    const sourceAlt = texture(16);
    const sourceGlass = texture(16);
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      blend_mode: 'blend_zwrite',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_TRANSLUCENT: 1,
      },
      resolvedTextures: {
        g_tAltTranslucency: sourceAlt,
        g_tGlass: sourceGlass,
      },
    });

    const result = buildDeadlockMaterial(base);
    const material = result.material as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
    const alphaMap = material.alphaMap;

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.opacity).toBe(0.62);
    expect(alphaMap).toBeTruthy();
    expect(alphaMap).not.toBe(sourceAlt);
    expect(alphaMap?.image).toBe(sourceAlt.image);
    expect(alphaMap?.image).not.toBe(sourceGlass.image);
    expect(material.transmissionMap).toBeUndefined();
    expect(result.ownedTextures).toContain(alphaMap);
    result.dispose();
  });

  it('keeps physical translucent bases on the alpha path', () => {
    const inheritedGlass = texture(16);
    const sourceAlt = texture(16);
    const base = physicalMaterialWithMorphic({
      shader: 'pbr.vfx',
      blend_mode: 'blend_zwrite',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_TRANSLUCENT: 1,
      },
      resolvedTextures: {
        g_tAltTranslucency: sourceAlt,
      },
    });
    base.transmission = 0.9;
    base.transmissionMap = inheritedGlass;

    const result = buildDeadlockMaterial(base);
    const material = result.material as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;
    const alphaMap = material.alphaMap;

    expect(material.isMeshStandardMaterial).toBe(true);
    expect(material.isMeshPhysicalMaterial).toBeUndefined();
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(alphaMap).toBeTruthy();
    expect(alphaMap).not.toBe(sourceAlt);
    expect(alphaMap?.image).toBe(sourceAlt.image);
    expect(material.transmission).toBeUndefined();
    expect(material.transmissionMap).toBeUndefined();
    result.dispose();
  });

  it('does not bind placeholder glass masks as transmission maps', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_GLASS: 1,
      },
      resolvedTextures: {
        g_tGlass: texture(4),
      },
    });

    const result = buildDeadlockMaterial(base);
    const material = result.material as THREE.MeshPhysicalMaterial;

    expect(material.transmission).toBeGreaterThan(0);
    expect(material.transmissionMap).toBeNull();
    result.dispose();
  });

  it('clears inherited physical transmission maps for rejected glass masks', () => {
    const inheritedGlass = texture(16);
    const base = physicalMaterialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_GLASS: 1,
      },
      resolvedTextures: {
        g_tGlass: texture(4),
      },
    });
    base.transmission = 0.7;
    base.transmissionMap = inheritedGlass;

    const result = buildDeadlockMaterial(base);
    const material = result.material as THREE.MeshPhysicalMaterial;

    expect(material.isMeshPhysicalMaterial).toBe(true);
    expect(material.transmission).toBeGreaterThan(0);
    expect(material.transmissionMap).toBeNull();
    expect(result.ownedTextures).not.toContain(inheritedGlass);
    result.dispose();
  });

  it('fails closed when dynamic glass and alpha overrides are not evaluated', () => {
    const glassSource = texture(16);
    const glassBase = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_GLASS: 1,
      },
      resolvedTextures: {
        g_tGlass: glassSource,
      },
      dynamic_texture_params: {
        g_tGlass: dynamicExpr('texture'),
      },
    });

    const glassResult = buildDeadlockMaterial(glassBase);
    const glassMaterial = glassResult.material as THREE.MeshPhysicalMaterial;

    expect(glassMaterial.transmission).toBeGreaterThan(0);
    expect(glassMaterial.transmissionMap).toBeNull();
    expect(glassResult.ownedTextures).not.toContain(glassSource);
    glassResult.dispose();

    const alphaSource = texture(16);
    const alphaBase = materialWithMorphic({
      shader: 'pbr.vfx',
      blend_mode: 'blend_zwrite',
      ints: {
        F_USE_NPR_LIGHTING: 1,
        F_TRANSLUCENT: 1,
      },
      floats: {
        g_flOpacityScale1: 0.25,
      },
      resolvedTextures: {
        g_tAltTranslucency: alphaSource,
      },
      dynamic_params: {
        g_flOpacityScale1: dynamicExpr('0.25'),
      },
    });

    const alphaResult = buildDeadlockMaterial(alphaBase);
    const alphaMaterial = alphaResult.material as THREE.MeshStandardMaterial;

    expect(alphaMaterial.transparent).toBe(true);
    expect(alphaMaterial.depthWrite).toBe(true);
    expect(alphaMaterial.opacity).toBe(1);
    expect(alphaMaterial.alphaMap).toBeNull();
    expect(alphaMaterial.alphaTest).toBe(0);
    alphaResult.dispose();
  });
});

describe('buildDeadlockMaterial highlight uniforms', () => {
  it('binds identity highlight uniforms for default material params', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasHighlight.value).toBe(0);
    expect(result.uniforms.uHighlightTint.value.toArray()).toEqual([0, 0, 0]);
    expect(result.uniforms.uHighlightCoverage.value).toBe(0);
    expect(result.uniforms.uHighlightRadius.value).toBe(0);
    result.dispose();
  });

  it('keeps Haze-like non-default tint disabled when coverage and hardness are zero', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
      floats: {
        g_flHighlightCoverage1: 0,
        g_flHighlightHardness1: 0,
        g_flHighlightRadius1: 96,
      },
      vectors: {
        g_vHighlightTint1: [0.35, 0.75, 1.2, 1],
        g_vHighlightPositionWs1: [4, 5, 6, 0],
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasHighlight.value).toBe(0);
    expect(result.uniforms.uHighlightBrightness.value).toBe(0);
    result.dispose();
  });

  it('keeps F6 highlight disabled in the unified NPR path even with meaningful params (Yamato white-wash guard)', () => {
    // F6's additive-sphere highlight white-washes any material that authors real
    // highlight coverage with a white tint (Yamato shogun_body/dress: coverage 0.35+,
    // tint [1,1,1], radius 256). It is disabled (F6_HIGHLIGHT_ENABLED=false) pending a
    // corrected, visually-validated reimplementation, so the unified builder must keep
    // uHasHighlight 0 even when every param is meaningful. highlightLayer itself stays
    // unit-tested in source2NprMaterial.test.ts.
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
      floats: {
        g_flHighlightCoverage1: 0.6,
        g_flHighlightHardness1: 0.4,
        g_flHighlightTintBrightness1: 1.3,
        g_flInvertHighlight1: 1,
        g_flHighlightRadius1: 128,
      },
      vectors: {
        g_vHighlightTint1: [1.1, 0.3, 0.2, 1],
        g_vHighlightPositionWs1: [100, 200, 300, 0],
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasHighlight.value).toBe(0);
    expect(result.uniforms.uHighlightCoverage.value).toBe(0);
    expect(result.uniforms.uHighlightRadius.value).toBe(0);
    result.dispose();
  });

  it('fails closed when highlight has a dynamic override', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
      floats: {
        g_flHighlightCoverage1: 0.6,
        g_flHighlightRadius1: 128,
      },
      vectors: {
        g_vHighlightTint1: [1, 0.5, 0.25, 1],
        g_vHighlightPositionWs1: [100, 200, 300, 0],
      },
      dynamic_params: {
        g_flHighlightCoverage1: dynamicExpr('0.6'),
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasHighlight.value).toBe(0);
    expect(result.uniforms.uHighlightRadius.value).toBe(0);
    result.dispose();
  });

  it('does not enable highlight on non-NPR self-illum materials', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_SELF_ILLUM: 1,
      },
      floats: {
        g_flSelfIllumScale1: 1,
        g_flHighlightCoverage1: 0.6,
        g_flHighlightRadius1: 128,
      },
      vectors: {
        g_vHighlightTint1: [1, 0.5, 0.25, 1],
        g_vHighlightPositionWs1: [100, 200, 300, 0],
      },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uNprCel.value).toBe(0);
    expect(result.uniforms.uHasHighlight.value).toBe(0);
    result.dispose();
  });

  it('keeps highlight uniforms after detail uniforms for shared GLSL binding order', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: {
        F_USE_NPR_LIGHTING: 1,
      },
    });

    const result = buildDeadlockMaterial(base);
    const keys = Object.keys(result.uniforms);

    expect(keys.indexOf('uHasHighlight')).toBeGreaterThan(keys.indexOf('uDetailUvChannel'));
    expect(keys.slice(keys.indexOf('uHasHighlight'), keys.indexOf('uHighlightRadius') + 1)).toEqual([
      'uHasHighlight',
      'uHighlightTint',
      'uHighlightCoverage',
      'uHighlightHardness',
      'uHighlightBrightness',
      'uHighlightInvert',
      'uHighlightPositionSource',
      'uHighlightRadius',
    ]);
    result.dispose();
  });
});

describe('buildDeadlockMaterial self-illum placeholder gate (Yamato shogun_body white-body)', () => {
  it('does not glow a placeholder-mask self-illum at a modest scale (shogun_body 0.27)', () => {
    const body = buildDeadlockMaterial(
      materialWithMorphic({
        shader: 'pbr.vfx',
        ints: { F_USE_NPR_LIGHTING: 1, F_SELF_ILLUM: 1 },
        floats: { g_flSelfIllumScale1: 0.27 },
        vectors: { g_vSelfIllumTint1: [1, 1, 1, 1] },
        self_illum_valid: false,
      })
    );
    expect(body.uniforms.uHasSelfIllum.value).toBe(0);
    body.dispose();
  });

  it('still glows a placeholder-mask self-illum at a clearly-intentional scale (familiar eyes 2.6)', () => {
    const eyes = buildDeadlockMaterial(
      materialWithMorphic({
        shader: 'pbr.vfx',
        ints: { F_SELF_ILLUM: 1 },
        floats: { g_flSelfIllumScale1: 2.6 },
        vectors: { g_vSelfIllumTint1: [0, 1, 1, 1] },
        self_illum_valid: false,
      })
    );
    expect(eyes.uniforms.uHasSelfIllum.value).toBe(1);
    // Hue-preserving cap is wired so the cyan tint at scale 2.6 does not ACES-wash to
    // white (familiar eyes "glow but white" bug).
    expect(eyes.uniforms.uSelfIllumCap.value).toBe(DEFAULT_NPR_TUNING.selfIllumCap);
    eyes.dispose();
  });

  it('glows a real-masked self-illum even at a low scale (viscous_head 0.629)', () => {
    const head = buildDeadlockMaterial(
      materialWithMorphic({
        shader: 'pbr.vfx',
        ints: { F_SELF_ILLUM: 1 },
        floats: { g_flSelfIllumScale1: 0.629 },
        resolvedTextures: { g_tSelfIllumMask: texture(64) },
        self_illum_valid: true,
      })
    );
    expect(head.uniforms.uHasSelfIllum.value).toBe(1);
    head.dispose();
  });
});

describe('buildDeadlockMaterial vertex-color albedo gate (Celeste dress regression)', () => {
  it.each(['F_VERTEX_COLOR', 'F_PAINT_VERTEX_COLORS'])(
    'sets uApplyVertexColor 1 when %s declares vertex-color albedo',
    (flagName) => {
      const result = buildDeadlockMaterial(
        materialWithMorphic({ shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, [flagName]: 1 } })
      );
      expect(result.uniforms.uApplyVertexColor.value).toBe(1);
      result.dispose();
    }
  );

  it('leaves uApplyVertexColor 0 for a tint-mask-only material so a (0,0,0) COLOR_0 cannot black the mesh', () => {
    // Celeste's dress: g_bMaskVertexColorTint1 vertex color, NO F_VERTEX_COLOR, and a
    // COLOR_0 of (0,0,0,0). GLTFLoader still enables USE_COLOR from the attribute, so
    // the gate (not the define) is what must keep the shader from multiplying to black.
    const dress = buildDeadlockMaterial(
      materialWithMorphic({
        shader: 'pbr.vfx',
        ints: { F_USE_NPR_LIGHTING: 1, g_bMaskVertexColorTint1: 1 },
      })
    );
    expect(dress.uniforms.uApplyVertexColor.value).toBe(0);
    dress.dispose();
  });
});

describe('buildDeadlockMaterial transmissive gate (F4)', () => {
  it('binds a real transmissive texture as an owned sRGB clone on an NPR material', () => {
    const trans = texture(8);
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: { F_USE_NPR_LIGHTING: 1 },
      vectors: { TextureNprTramsissiveColor1: [0, 0.6, 1, 0] },
      resolvedTextures: { g_tNprTransmissiveColor: trans },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasTransmissive.value).toBe(1);
    const bound = result.uniforms.uNprTransmissiveColor.value as THREE.Texture;
    expect(bound).not.toBe(trans); // owned clone, not the shared resolved texture
    expect(result.ownedTextures).toContain(bound);
    expect(bound.colorSpace).toBe(THREE.SRGBColorSpace);
    const tint = result.uniforms.uNprTransmissiveTint.value as THREE.Color;
    expect(tint.g).toBeCloseTo(0.6);
    expect(tint.b).toBeCloseTo(1);
    result.dispose();
  });

  it('rejects a 4x4 placeholder transmissive texture (uHasTransmissive 0)', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: { F_USE_NPR_LIGHTING: 1 },
      resolvedTextures: { g_tNprTransmissiveColor: texture(4) },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasTransmissive.value).toBe(0);
    result.dispose();
  });

  it('keeps transmissive off on a non-NPR (self-illum-only) material', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: { F_SELF_ILLUM: 1 },
      floats: { g_flSelfIllumScale1: 0.629 },
      resolvedTextures: { g_tNprTransmissiveColor: texture(8) },
    });

    const result = buildDeadlockMaterial(base);

    // Transmissive is NPR-only; a non-NPR glow material must not pick it up.
    expect(result.uniforms.uNprCel.value).toBe(0);
    expect(result.uniforms.uHasTransmissive.value).toBe(0);
    result.dispose();
  });
});

describe('buildDeadlockMaterial rim mask (F8)', () => {
  it('passes the rim uniforms and binds the tint/rim mask as a linear owned clone', () => {
    const rimMask = texture(8); // NoColorSpace from the helper
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: { F_USE_NPR_LIGHTING: 1 },
      resolvedTextures: { g_tTintMaskRimLightMask: rimMask },
    });

    const result = buildDeadlockMaterial(base);

    // Rim uniforms reach the CSM.
    expect(result.uniforms.uRimStrength.value).toBe(DEFAULT_NPR_TUNING.rimStrength);
    expect(result.uniforms.uRimPower.value).toBe(DEFAULT_NPR_TUNING.rimPower);
    expect(result.uniforms.uRimColor.value).toBeInstanceOf(THREE.Color);

    // Mask is bound, owned (cloned), and stays LINEAR: rim/tint constants warp if
    // read as sRGB, so unlike detail/transmissive the builder must NOT tag it sRGB.
    expect(result.uniforms.uHasTintMask.value).toBe(1);
    const bound = result.uniforms.uTintRimMask.value as THREE.Texture;
    expect(bound).not.toBe(rimMask);
    expect(result.ownedTextures).toContain(bound);
    expect(bound.colorSpace).toBe(THREE.NoColorSpace);
    result.dispose();
  });

  it('falls back to the white mask with uHasTintMask 0 when no rim mask is resolved', () => {
    const base = materialWithMorphic({
      shader: 'pbr.vfx',
      ints: { F_USE_NPR_LIGHTING: 1 },
    });

    const result = buildDeadlockMaterial(base);

    expect(result.uniforms.uHasTintMask.value).toBe(0);
    result.dispose();
  });
});
