import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import { DEADLOCK_BASE_POST, type PostPipeline, type SourcePostSettings } from '../../lib/particles/render/post';
import { SourcePostPass } from '../../lib/particles/render/post/sourcePostPass';
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
  /**
   * 'preview' keeps the viewer's own bloom and tone curve. 'source2' runs ValveResourceFormat's post
   * process with the host's sourceSettings (its bloom, exposure bias, 2.8 pre-scale and
   * white point), for the particle runtime: see src/lib/particles/render/README.md.
   */
  pipeline?: PostPipeline;
  /** The host scene's authored post volume. Independent of the particle system being drawn. */
  sourceSettings?: SourcePostSettings;
  /** The game's r_post_bloom switch. The viewer's switch may disable bloom further. */
  sourceBloomEnabled?: boolean;
}

export function BloomEffect({ intensity, radius, threshold, deadlockExposure, pipeline = 'preview', sourceSettings = DEADLOCK_BASE_POST, sourceBloomEnabled = true }: BloomParams) {
  const tone = useMemo(() => new Effect('DeadlockTone', DEADLOCK_TONE_SHADER, {
    uniforms: new Map([['previewExposure', new THREE.Uniform(deadlockExposure ?? 1)]]),
  }), [deadlockExposure]);
  useEffect(() => () => tone.dispose(), [tone]);

  // Switching bloom off drops the volume's bloom
  const sourceBloom = intensity > 0 && sourceBloomEnabled;
  // NPR ambient normalization divides by this same scene exposure. Matching an
  // older display curve here cancels the authored post bias and breaks that pair.
  const sourceExposure = deadlockExposure ?? 1;
  const sourceVolume = useMemo(() => ({ ...sourceSettings, exposure: sourceExposure }), [sourceSettings, sourceExposure]);
  const sourcePost = useMemo(
    () => (pipeline === 'source2' ? new SourcePostPass({ ...sourceVolume, bloom: sourceBloom ? sourceVolume.bloom : null }) : null),
    [pipeline, sourceBloom, sourceVolume],
  );
  useEffect(() => () => sourcePost?.dispose(), [sourcePost]);

  // What the Source 2 post shows the frame through, for passes that copy the scene (sceneColor.ts)
  const getThree = useThree((state) => state.get);
  useEffect(() => {
    const { userData } = getThree().scene;
    userData.sourcePostSettings = sourcePost ? sourceVolume : undefined;
    return () => { delete userData.sourcePostSettings; };
  }, [getThree, sourcePost, sourceVolume]);

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
