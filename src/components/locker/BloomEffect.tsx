import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, SelectiveBloom, ToneMapping } from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import { DEADLOCK_TONE_SHADER } from './heroViewerTone';
import { isSelfIllumMaterial } from '../../lib/source2NprMaterial';

/**
 * Selective bloom for preview glow materials and authored emissive particles.
 *
 * Built on @react-three/postprocessing so the HDR pipeline + tonemapping/colorspace are
 * handled by a maintained lib instead of hand-rolled composer wiring (which kept
 * shifting the base look). SelectiveBloom blooms ONLY the meshes we hand it - self-illum
 * and unlit (glowy panels / stained glass) - so matte body/skin/cloth and metal never
 * bloom. Bloom runs in linear HDR before the requested tone curve.
 */

// Self-illum (morphic F_SELF_ILLUM) or unlit (toneMapped=false) surfaces bloom. Metal
// intentionally does not.
function isBloomMaterial(mat: THREE.Material): boolean {
  return mat.userData.previewBloom === true || mat.toneMapped === false || isSelfIllumMaterial(mat);
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
  deadlockExposure?: number;
}

export function BloomEffect({ intensity, radius, threshold, deadlockExposure }: BloomParams) {
  const scene = useThree((s) => s.scene);
  const tone = useMemo(() => new Effect('DeadlockTone', DEADLOCK_TONE_SHADER, {
    uniforms: new Map([['previewExposure', new THREE.Uniform(deadlockExposure ?? 1)]]),
  }), [deadlockExposure]);
  useEffect(() => () => tone.dispose(), [tone]);
  // The hero GLB loads async into the scene, so re-collect the bloom-worthy meshes each
  // frame and only update state (re-arming SelectiveBloom) when the set actually changes.
  const [selection, setSelection] = useState<THREE.Object3D[]>([]);
  const [lights, setLights] = useState<THREE.Object3D[]>([]);
  useFrame(() => {
    const next: THREE.Object3D[] = [];
    const nextLights: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (meshBlooms(o)) next.push(o);
      if ((o as THREE.Light).isLight) nextLights.push(o);
    });
    setSelection((prev) => (sameMembers(prev, next) ? prev : next));
    setLights((prev) => (sameMembers(prev, nextLights) ? prev : nextLights));
  });

  return (
    <EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType}>
      {/* Keep the effect graph stable: removing bloom can strand the tone pass
          offscreen after a composer rebuild. Zero intensity preserves live frames. */}
      {lights.length > 0 && <SelectiveBloom
        lights={lights}
        selection={selection}
        intensity={intensity}
        radius={radius}
        luminanceThreshold={threshold}
        luminanceSmoothing={0.2}
        mipmapBlur
      />}
      {deadlockExposure === undefined
        ? <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        : <primitive object={tone} />}
    </EffectComposer>
  );
}
