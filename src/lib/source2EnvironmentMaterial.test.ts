import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applySource2EnvironmentMaterial, source2LayerColorCorrection, source2OverlayFactor } from './source2EnvironmentMaterial';
import { applySource2ColorCorrection } from './source2ColorCorrection';
import type { MorphicExtras } from './source2NprMaterial';

function fixture() {
  const material = new THREE.MeshStandardMaterial();
  material.userData.morphic = {
    shader: 'environment_blend.vfx', ints: {},
    floats: { g_fLayerNormalStrength1: 0.694 },
    vectors: { g_vLayerRoughnessContrastBrightness1: [0.899, -0.101, 0, 0],
      g_vAlbedoContrastSaturationBrightness1: [2, 0.79, 0.57, 0] },
    texture_reflectivity: { g_tColor: [0.2791, 0.1695, 0.1102, 1] },
  } satisfies MorphicExtras;
  return material;
}

function compile(material: THREE.Material) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) };
  Reflect.apply(material.onBeforeCompile, material, [shader, THREE.WebGLRenderer.prototype]);
  return shader;
}

describe('authored environment layer controls', () => {
  it('applies the authored roughness and normal strength to the exported Cartesian normals', () => {
    const material = fixture();
    applySource2EnvironmentMaterial(material);
    const shader = compile(material);
    expect(material.normalScale.toArray()).toEqual([0.694, 0.694]);
    expect(shader.uniforms.source2LayerRoughness.value.toArray()).toEqual([0.899, -0.101]);
    expect(shader.fragmentShader).toContain('#include <normal_fragment_maps>');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.fragmentShader).toContain('source2LayerColorMatrix * sampledDiffuseColor.rgb + source2LayerColorOffset');
    material.dispose();
  });

  it('corrects the layer albedo around its texture reflectivity before the tint', () => {
    const material = fixture();
    applySource2EnvironmentMaterial(material);
    const { source2LayerColorMatrix: matrix, source2LayerColorOffset: offset } = compile(material).uniforms;
    const texel = new THREE.Vector3(0.35, 0.2, 0.12);
    const expected = applySource2ColorCorrection(texel, new THREE.Vector3(2, 0.79, 0.57), new THREE.Vector3(0.2791, 0.1695, 0.1102));
    const actual = texel.clone().applyMatrix3(matrix.value).add(offset.value);
    actual.toArray().forEach((value, i) => expect(value).toBeCloseTo(expected.getComponent(i), 6));
    material.dispose();
  });

  it('leaves the albedo unchanged without a correction or its compiled pivot', () => {
    for (const [csb, pivot] of [[undefined, [0.2, 0.2, 0.2, 1]], [[2, 0.5, 1.5, 0], undefined]] as const) {
      const { matrix, offset } = source2LayerColorCorrection(csb ? [...csb] : undefined, pivot ? [...pivot] : undefined);
      expect(matrix.equals(new THREE.Matrix3())).toBe(true);
      expect(offset.length()).toBeCloseTo(0, 9);
    }
  });

  it('preserves unsupported shader families and preceding shader patches', () => {
    const unsupported = fixture();
    unsupported.userData.morphic.shader = 'environment_parallax_layered.vfx';
    const before = unsupported.onBeforeCompile;
    applySource2EnvironmentMaterial(unsupported);
    expect(unsupported.onBeforeCompile).toBe(before);
    const material = fixture();
    material.onBeforeCompile = shader => { shader.fragmentShader += '\n// preceding patch'; };
    material.customProgramCacheKey = () => 'preceding';
    applySource2EnvironmentMaterial(material);
    expect(compile(material).fragmentShader).toContain('// preceding patch');
    expect(material.customProgramCacheKey()).toBe('preceding:source2-environment-layer-v3');
    unsupported.dispose(); material.dispose();
  });
});

describe('environment world overlay', () => {
  function overlayFixture(flag: number) {
    const material = fixture();
    const data = material.userData.morphic as MorphicExtras;
    data.ints = { F_WORLD_OVERLAY: flag, g_nWorldOverlayTintMask1: 0 };
    data.floats = { ...data.floats, g_flWorldOverlayTiling: 700, g_flWorldOverlayDarknessContrast: 0.2, g_flWorldOverlayBrightnessContrast: 1.182 };
    data.resolvedTextures = { g_tColorWorldOverlay: new THREE.Texture() };
    return material;
  }

  it('follows VRF GetOverlayFactor: a signed multiplier around mid grey with separate contrasts', () => {
    expect(source2OverlayFactor(0.5, 1, 1)).toBe(1);
    expect(source2OverlayFactor(1, 1, 1)).toBe(2);
    expect(source2OverlayFactor(0, 1, 1)).toBe(0);
    // The hideout floor: brightening contrast 1.182, darkening 0.2.
    expect(source2OverlayFactor(0.75, 0.2, 1.182)).toBeCloseTo((1 - 0.5 ** 1.182) * 1.182 + 1, 9);
    expect(source2OverlayFactor(0.25, 0.2, 1.182)).toBeCloseTo((0.5 ** 0.2 - 1) * 0.2 + 1, 9);
  });

  it('projects the overlay in Source space for single-overlay materials only', () => {
    const sourceFromViewer = new THREE.Matrix4().makeScale(39.37, 39.37, 39.37);
    const material = overlayFixture(1);
    applySource2EnvironmentMaterial(material, sourceFromViewer);
    const shader = compile(material);
    expect(shader.uniforms.source2WorldOverlayFromViewer.value).toBe(sourceFromViewer);
    expect(shader.uniforms.source2WorldOverlayParams.value.toArray()).toEqual([700, 0.2, 1.182, 1]);
    expect(shader.uniforms.source2WorldOverlayMask.value).toBe(0);
    expect(shader.vertexShader).toContain('vSource2OverlayPosition = (source2WorldOverlayFromViewer * modelMatrix');
    expect(shader.fragmentShader).toContain('source2WorldOverlaySample()');
    expect(material.customProgramCacheKey()).toContain(':overlay');
    // Two overlays (F_WORLD_OVERLAY 2) and a missing placement stay unported.
    for (const [flag, placement] of [[2, sourceFromViewer], [1, undefined]] as const) {
      const other = overlayFixture(flag);
      applySource2EnvironmentMaterial(other, placement);
      expect(compile(other).fragmentShader).not.toContain('source2WorldOverlaySample');
      other.dispose();
    }
    material.dispose();
  });
});
