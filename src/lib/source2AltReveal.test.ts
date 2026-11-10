import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SOURCE2_REST_ATTRIBUTES, source2AltReveal, source2AltRevealAmount, source2AltRevealFactor } from './source2AltReveal';
import { NPR_FRAGMENT, SOURCE2_PREVIEW_TEXTURE_SLOTS, applyNprMapDefines, citadelColorUniforms } from './source2NprMaterial';
import type { MorphicExtras } from './source2NprMaterial';

const texture = new THREE.Texture();

function material(extra: Partial<MorphicExtras> = {}, bound = true): MorphicExtras {
  return { shader: 'pbr.vfx', ...(bound ? { resolvedTextures: { g_tAltColor_Reveal: texture } } : {}), ...extra };
}

function expression(source: string, decompiled = true): NonNullable<MorphicExtras['dynamic_params']> {
  return { g_flAltTextureAmount: { source, decompiled, byte_len: source.length, attributes: [], hash: 'test' } };
}

// Authored values from the game's materials (pak01, 2026-11).
const BRUSH = 'max($AmmoPercent,smoothstep(0.5,1,$ReloadProgress))';

describe('source2AltRevealAmount', () => {
  it('shows a full magazine on the brush that ammo inks', () => {
    expect(SOURCE2_REST_ATTRIBUTES).toEqual({ $AmmoPercent: 1, $ReloadProgress: 0 });
    expect(source2AltRevealAmount(material({ floats: { g_flAltTextureAmount: 0 }, dynamic_params: expression(BRUSH) }))).toBe(1);
  });

  it('keeps the authored amount when the expression reads state the preview has no value for', () => {
    // Solomon's queen, Nurse Harrow's ult face, the lantern bulb's health.
    for (const source of ['$BlackAmount', '$nurse_face_alt', '1 - $ent_health']) {
      expect(source2AltRevealAmount(material({ floats: { g_flAltTextureAmount: 0 }, dynamic_params: expression(source) }))).toBe(0);
    }
    // The nurse bag eye: random() is outside the evaluator.
    const eye = 'clamp(0 + 0.5 * sin(time() * 6.2832 * 0.1) + random(-0.0072,0.0072),0,0.5)';
    expect(source2AltRevealAmount(material({ floats: { g_flAltTextureAmount: 0.407 }, dynamic_params: expression(eye) }))).toBeCloseTo(0.407, 6);
    expect(source2AltRevealAmount(material({ floats: { g_flAltTextureAmount: 0.3 }, dynamic_params: expression('', false) }))).toBeCloseTo(0.3, 6);
  });

  it('reads a static amount and clamps it to the shader range', () => {
    expect(source2AltRevealAmount(material({ floats: { g_flAltTextureAmount: 0.52 } }))).toBeCloseTo(0.52, 6);
    expect(source2AltRevealAmount(material({ floats: { g_flAltTextureAmount: 4 } }))).toBe(1);
    expect(source2AltRevealAmount(material())).toBe(0);
  });
});

describe('source2AltReveal', () => {
  it('is off unless the texture is bound, the shader is pbr.vfx and the amount is above zero', () => {
    const inked = { floats: { g_flAltTextureAmount: 0, g_flAltTextureRevealSoftness: 0 }, dynamic_params: expression(BRUSH) };
    expect(source2AltReveal(material(inked))).toEqual({ texture, amount: 1, softness: 0 });
    expect(source2AltReveal(material(inked, false))).toBeNull();
    expect(source2AltReveal(material({ ...inked, shader: 'environment_blend.vfx' }))).toBeNull();
    expect(source2AltReveal(material({ floats: { g_flAltTextureAmount: 0 } }))).toBeNull();
  });

  it('defaults the softness to the shader default and keeps it in the authoring range', () => {
    expect(source2AltReveal(material({ floats: { g_flAltTextureAmount: 0.5 } }))?.softness).toBeCloseTo(0.05, 6);
    expect(source2AltReveal(material({ floats: { g_flAltTextureAmount: 0.5, g_flAltTextureRevealSoftness: 3 } }))?.softness).toBe(0.5);
  });
});

describe('source2AltRevealFactor', () => {
  it('replaces the color everywhere at an amount of 1, whatever the mask', () => {
    // The brush handle has a mask of 0 and the bristle base close to 1.
    for (const mask of [0, 0.3, 0.95, 1]) expect(source2AltRevealFactor(1, 0, mask)).toBe(1);
    for (const mask of [0, 0.5, 1]) expect(source2AltRevealFactor(0, 0.05, mask)).toBe(0);
  });

  it('reveals low mask values first, with a hard edge at zero softness', () => {
    // The pick screen brush: amount 0.52, softness 0.
    expect(source2AltRevealFactor(0.52, 0, 0)).toBe(1);
    expect(source2AltRevealFactor(0.52, 0, 0.4)).toBe(1);
    expect(source2AltRevealFactor(0.52, 0, 0.6)).toBe(0);
    expect(source2AltRevealFactor(0.52, 0, 0.52)).toBe(0);
  });

  it('blends across the softness band around the remapped mask', () => {
    // mask 0.5 at softness 0.1 sits at threshold 0.5; the band is 0.4..0.6.
    expect(source2AltRevealFactor(0.5, 0.1, 0.5)).toBeCloseTo(0.5, 6);
    expect(source2AltRevealFactor(0.39, 0.1, 0.5)).toBe(0);
    expect(source2AltRevealFactor(0.61, 0.1, 0.5)).toBe(1);
    expect(source2AltRevealFactor(0.55, 0.1, 0.5)).toBeCloseTo(0.84375, 6);
    // A mask of 0 still needs the amount to clear the softness band.
    expect(source2AltRevealFactor(0.05, 0.1, 0)).toBeCloseTo(0.1558, 3);
    expect(source2AltRevealFactor(0.21, 0.1, 0)).toBe(1);
  });
});

describe('the alt reveal in the hero material', () => {
  const inked = material({ floats: { g_flAltTextureAmount: 0, g_flAltTextureRevealSoftness: 0 }, dynamic_params: expression(BRUSH) });
  const plain = material({ floats: { g_flAltTextureAmount: 0 } });

  function defines(morphic: MorphicExtras): Record<string, unknown> {
    const target = new THREE.MeshStandardMaterial();
    target.userData.morphic = morphic;
    applyNprMapDefines(target, false, false);
    return target.defines ?? {};
  }

  it('resolves the exported slot', () => {
    expect(SOURCE2_PREVIEW_TEXTURE_SLOTS).toContain('g_tAltColor_Reveal');
  });

  it('binds the sampler only for a material that reveals', () => {
    const uniforms = citadelColorUniforms(inked);
    expect(uniforms.uAltRevealMap.value).toBe(texture);
    expect(uniforms.uAltReveal.value).toEqual(new THREE.Vector2(1, 0));
    expect(defines(inked)).toHaveProperty('NPR_ALT_REVEAL');

    expect(citadelColorUniforms(plain)).not.toHaveProperty('uAltRevealMap');
    expect(defines(plain)).not.toHaveProperty('NPR_ALT_REVEAL');
  });

  it('mixes the alt albedo after the color correction, tint and vertex color', () => {
    const reveal = NPR_FRAGMENT.indexOf('source2AltRevealFactor(altTexel.a)');
    expect(reveal).toBeGreaterThan(NPR_FRAGMENT.lastIndexOf('applyAlbedoCSB(csm_DiffuseColor.rgb'));
    expect(reveal).toBeGreaterThan(NPR_FRAGMENT.indexOf('uSource2ColorTint * csm_DiffuseColor.rgb'));
    expect(reveal).toBeLessThan(NPR_FRAGMENT.indexOf('if (uHasDetail > 0.5)'));
    // The sampler costs a texture unit, so it and its uniforms sit behind the define.
    expect(NPR_FRAGMENT.match(/uAltRevealMap/g)?.length).toBe(3);
    expect(NPR_FRAGMENT.indexOf('#ifdef NPR_ALT_REVEAL')).toBeLessThan(NPR_FRAGMENT.indexOf('uniform sampler2D uAltRevealMap'));
  });
});
