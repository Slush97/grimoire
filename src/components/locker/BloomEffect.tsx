import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import { DEADLOCK_BASE_POST, exposureForDisplay, type PostPipeline } from '../../lib/particles/render/post';
import { SourcePostPass } from '../../lib/particles/render/post/sourcePostPass';
import { DEADLOCK_TONE_SHADER, deadlockTone } from './heroViewerTone';

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
  /**
   * 'preview' keeps the viewer's own bloom and tone curve. 'source2' runs ValveResourceFormat's post
   * process with basepostprocess_deadlock.vpost instead (its bloom, exposure bias, 2.8 pre-scale and
   * white point), for the particle runtime: see src/lib/particles/render/README.md.
   */
  pipeline?: PostPipeline;
}

export function BloomEffect({ intensity, radius, threshold, deadlockExposure, pipeline = 'preview' }: BloomParams) {
  const tone = useMemo(() => new Effect('DeadlockTone', DEADLOCK_TONE_SHADER, {
    uniforms: new Map([['previewExposure', new THREE.Uniform(deadlockExposure ?? 1)]]),
  }), [deadlockExposure]);
  useEffect(() => () => tone.dispose(), [tone]);

  const sourceExposure = useMemo(() => {
    // The viewer's lights are calibrated against its preview curve, so the tonemap scalar (which a
    // map's auto exposure would set in game) is the one that shows mid grey as the preview does
    const display = deadlockTone(0.18 * (deadlockExposure ?? 1));
    const encoded = display <= 0.0031308 ? display * 12.92 : 1.055 * display ** (1 / 2.4) - 0.055;
    return exposureForDisplay(DEADLOCK_BASE_POST, 0.18, encoded);
  }, [deadlockExposure]);

  // Switching bloom off drops the volume's bloom
  const sourceBloom = intensity > 0;
  const sourcePost = useMemo(
    () => (pipeline === 'source2' ? new SourcePostPass({ ...DEADLOCK_BASE_POST, exposure: sourceExposure, bloom: sourceBloom ? DEADLOCK_BASE_POST.bloom : null }) : null),
    [pipeline, sourceExposure, sourceBloom],
  );
  useEffect(() => () => sourcePost?.dispose(), [sourcePost]);

  // What the Source 2 post shows the frame through, for passes that copy the scene (sceneColor.ts)
  const getThree = useThree((state) => state.get);
  useEffect(() => {
    const { userData } = getThree().scene;
    userData.sourcePostSettings = sourcePost ? { ...DEADLOCK_BASE_POST, exposure: sourceExposure } : undefined;
    return () => { delete userData.sourcePostSettings; };
  }, [getThree, sourcePost, sourceExposure]);

  if (sourcePost !== null) {
    return (
      <EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType}>
        <primitive object={sourcePost} />
      </EffectComposer>
    );
  }

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
