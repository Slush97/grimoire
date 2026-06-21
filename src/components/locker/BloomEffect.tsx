import { useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, SelectiveBloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { isSelfIllumMaterial } from '../../lib/source2NprMaterial';

/**
 * Optional SELECTIVE bloom for the hero preview (dev-only `bloom` toggle, default off).
 *
 * Built on @react-three/postprocessing so the HDR pipeline + tonemapping/colorspace are
 * handled by a maintained lib instead of hand-rolled composer wiring (which kept
 * shifting the base look). SelectiveBloom blooms ONLY the meshes we hand it - self-illum
 * and unlit (glowy panels / stained glass) - so matte body/skin/cloth and metal never
 * bloom. Bloom runs in linear HDR before <ToneMapping> ACES-tonemaps the frame (the lib
 * renders the scene with NoToneMapping while mounted), matching the inline ACES look.
 */

// Self-illum (morphic F_SELF_ILLUM) or unlit (toneMapped=false) surfaces bloom. Metal
// intentionally does not.
function isBloomMaterial(mat: THREE.Material): boolean {
  return mat.toneMapped === false || isSelfIllumMaterial(mat);
}

function meshBlooms(obj: THREE.Object3D): boolean {
  const mesh = obj as THREE.Mesh;
  if (!mesh.isMesh || !mesh.material) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some(isBloomMaterial);
}

function sameMembers(a: THREE.Object3D[], b: THREE.Object3D[]): boolean {
  return a.length === b.length && a.every((o, i) => o === b[i]);
}

export interface BloomParams {
  /** Bloom strength: how much the glow is added back. */
  intensity: number;
  /** Bloom radius (0..1): how far the halo spreads. */
  radius: number;
  /** Luminance threshold (linear): only pixels brighter than this, on selected meshes, bloom. */
  threshold: number;
}

export function BloomEffect({ intensity, radius, threshold }: BloomParams) {
  const scene = useThree((s) => s.scene);
  // The hero GLB loads async into the scene, so re-collect the bloom-worthy meshes each
  // frame and only update state (re-arming SelectiveBloom) when the set actually changes.
  const [selection, setSelection] = useState<THREE.Object3D[]>([]);
  useFrame(() => {
    const next: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (meshBlooms(o)) next.push(o);
    });
    setSelection((prev) => (sameMembers(prev, next) ? prev : next));
  });

  return (
    <EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType}>
      <SelectiveBloom
        selection={selection}
        intensity={intensity}
        radius={radius}
        luminanceThreshold={threshold}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
