import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import { DEADLOCK_TONE_SHADER } from './heroViewerTone';

/**
 * HDR bloom for preview glow materials and authored emissive particles.
 *
 * Built on @react-three/postprocessing so the HDR pipeline + tonemapping/colorspace are
 * handled by a maintained lib instead of hand-rolled composer wiring (which kept
 * shifting the base look). Like Source 2, bloom is driven by HDR luminance alone: only
 * radiance above the linear threshold blooms, so lit body/skin/cloth and metal stay
 * clean while self-illum surfaces and stacked additive particles glow.
 *
 * SelectiveBloom cannot serve particles. It keeps a pixel only where the selected
 * object's depth equals the scene depth, and sprites, ropes and trails write no depth.
 */

export interface BloomParams {
  /** Bloom strength: how much the glow is added back. */
  intensity: number;
  /** Bloom radius (0..1): how far the halo spreads. */
  radius: number;
  /** Luminance threshold (linear HDR): only pixels brighter than this bloom. */
  threshold: number;
  deadlockExposure?: number;
}

export function BloomEffect({ intensity, radius, threshold, deadlockExposure }: BloomParams) {
  const tone = useMemo(() => new Effect('DeadlockTone', DEADLOCK_TONE_SHADER, {
    uniforms: new Map([['previewExposure', new THREE.Uniform(deadlockExposure ?? 1)]]),
  }), [deadlockExposure]);
  useEffect(() => () => tone.dispose(), [tone]);

  return (
    <EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType}>
      {/* Keep the effect graph stable: removing bloom can strand the tone pass
          offscreen after a composer rebuild. Zero intensity preserves live frames. */}
      <Bloom
        intensity={intensity}
        radius={radius}
        luminanceThreshold={threshold}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      {deadlockExposure === undefined
        ? <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        : <primitive object={tone} />}
    </EffectComposer>
  );
}
