import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { HideoutSceneInfo } from '../../types/skinEditor';
import { Source2FogPass, parseSource2FogShadowAtlas } from '../../lib/source2Atmosphere';
import { decodeSource2Volume, parseSource2Volume } from '../../lib/source2ProbeVolume';
import { takeHideoutFog } from '../../lib/hideoutPreload';
import { BloomEffect } from './BloomEffect';

async function loadMapLut(info: HideoutSceneInfo): Promise<THREE.Data3DTexture | null> {
  if (!info.lut) return null;
  const { dimension, file } = info.lut;
  const response = await fetch(`grimoire-hero://s/${info.key}/${file}`);
  if (!response.ok) throw new Error('Map color correction could not be read.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== dimension ** 3 * 4) throw new Error('Invalid map color correction length.');
  const texture = new THREE.Data3DTexture(new Uint8Array(bytes), dimension, dimension, dimension);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

async function loadMapFog(info: HideoutSceneInfo): Promise<THREE.Data3DTexture | null> {
  if (!info.fog) return null;
  // Usually decoded in the hideout's preload worker (hideoutPreload).
  const preloaded = await takeHideoutFog(info.key)?.catch(() => null);
  if (preloaded) return parseSource2Volume(preloaded, false);
  const response = await fetch(`grimoire-hero://s/${info.key}/${info.fog.file}`);
  if (!response.ok) throw new Error('Map fog could not be read.');
  return decodeSource2Volume(await response.arrayBuffer(), false);
}

/** The map and hero share one HDR post pass and one authored exposure. */
export function Source2MapPost({ info, bloom = true, halfResolutionFog = false }: {
  info: HideoutSceneInfo; bloom?: boolean;
  /** Marches the fog at half resolution (Source2FogPass.setHalfResolution). */
  halfResolutionFog?: boolean;
}) {
  const getThree = useThree(state => state.get);
  const [resources, setResources] = useState<{ lut: THREE.Data3DTexture | null; fog: Source2FogPass | null } | null>(null);
  const correction = useMemo(() => resources?.lut ? { lut: resources.lut, weight: 1 } : null, [resources]);
  useEffect(() => {
    const { scene } = getThree();
    let cancelled = false;
    let owned: { lut: THREE.Data3DTexture | null; fog: Source2FogPass | null; volume: THREE.Data3DTexture | null } | null = null;
    scene.userData.source2MapPostReady = !info.lut && !info.fog;
    let shadows: THREE.DataTexture | null = null;
    void Promise.all([loadMapLut(info), loadMapFog(info)]).then(([lut, volume]) => {
      owned = { lut, volume, fog: volume && info.fog ? new Source2FogPass(info.fog, volume, info.lights, () => getThree()) : null };
      if (cancelled) return;
      setResources({ lut: owned.lut, fog: owned.fog });
      scene.userData.source2MapPostReady = true;
      // The fog's light shadows load after it first draws: they only take light away.
      const fog = owned.fog;
      if (fog && info.fogShadows) void fetch(`grimoire-hero://s/${info.key}/${info.fogShadows.file}`)
        .then(response => { if (!response.ok) throw new Error('Map fog shadows could not be read.'); return response.arrayBuffer(); })
        .then(bytes => { if (cancelled) return; shadows = parseSource2FogShadowAtlas(bytes); fog.setShadowAtlas(shadows); })
        .catch(() => {});
    }).catch(() => { if (!cancelled) scene.userData.source2MapPostFailed = true; });
    return () => {
      cancelled = true;
      owned?.lut?.dispose(); owned?.volume?.dispose(); owned?.fog?.dispose(); shadows?.dispose();
      delete scene.userData.source2MapPostReady; delete scene.userData.source2MapPostFailed;
    };
  }, [info, getThree]);
  useEffect(() => { resources?.fog?.setHalfResolution(halfResolutionFog); }, [resources, halfResolutionFog]);
  if (!info.post) return null;
  return <BloomEffect pipeline="source2" sourceSettings={info.post} sceneExposure={info.exposure}
    deadlockExposure={info.exposure} colorCorrection={correction} sourceScenePass={resources?.fog ?? null}
    intensity={bloom ? 1 : 0} radius={0} threshold={0} />;
}
