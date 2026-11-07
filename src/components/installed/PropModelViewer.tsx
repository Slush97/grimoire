import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Loader2 } from 'lucide-react';
import { exportSoulModel, getSoulModelInfo } from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import { buildNormalizedRoot, disposeScene, meshUrlFor, zeroMetalness } from '../locker/soulModel';

type LoadedProp = { root: THREE.Group; scene: THREE.Object3D; clip: THREE.AnimationClip | null };

/** The prop's idle loop when it has one (an urn's `idol_urn_idle`, the vault's `idle`). */
function idleClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  return clips.find(clip => clip.name.toLowerCase() === 'idle') ?? clips.find(clip => /idle/i.test(clip.name)) ?? clips[0] ?? null;
}

/** A neutral studio room for image-based light, built locally (no HDR download). */
function StudioLight() {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    // eslint-disable-next-line react-hooks/immutability -- the R3F scene is a mutable three object, set once per canvas
    scene.environment = texture;
    return () => { scene.environment = null; texture.dispose(); room.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

function PropModel({ prop, turn }: { prop: LoadedProp; turn: RefObject<number | null> }) {
  const group = useRef<THREE.Group>(null);
  const mixer = useMemo(() => prop.clip ? new THREE.AnimationMixer(prop.scene) : null, [prop]);
  useEffect(() => {
    if (!mixer || !prop.clip) return;
    mixer.clipAction(prop.clip).play();
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(prop.scene); };
  }, [mixer, prop]);
  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1);
    mixer?.update(step);
    const g = group.current;
    if (g) g.rotation.y += ((turn.current ?? 0) - g.rotation.y) * (1 - Math.exp(-step * 14));
  });
  return <group ref={group}><primitive object={prop.root} /></group>;
}

/**
 * 3D preview of a mod that reskins a prop (soul container, spirit urn, Sinner's Sacrifice), for the
 * Installed peek and pinned panel. Exports the mod's model through the soul-model pipeline with its
 * rig and clips kept, plays its idle loop, and lights it like the hero viewer's transparent scene.
 */
export default function PropModelViewer({ metaKey, cacheKey, entry, active, turn }: {
  metaKey: string;
  /** Content-stable export cache key, distinct from the Locker grid's static export. */
  cacheKey: string;
  entry: string;
  active: boolean;
  turn: RefObject<number | null>;
}) {
  const { t } = useTranslation();
  const [prop, setProp] = useState<LoadedProp | null>(null);
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
  useEffect(() => {
    let cancelled = false;
    let loaded: LoadedProp | null = null;
    void (async () => {
      try {
        let info = await getSoulModelInfo(cacheKey);
        if (!info.hasModel) info = await exportSoulModel(metaKey, cacheKey, entry, { animated: true });
        if (!info.hasModel) throw new Error('No model exported');
        const gltf = await loadGltfPreview(meshUrlFor(cacheKey, info.mtimeMs));
        if (cancelled) { disposeScene(gltf.scene); return; }
        zeroMetalness(gltf.scene);
        // Bounds come from the rest pose, so an animated rig must not be culled as it moves.
        gltf.scene.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) object.frustumCulled = false; });
        loaded = { root: buildNormalizedRoot(gltf.scene), scene: gltf.scene, clip: idleClip(gltf.animations) };
        setProp(loaded);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => { cancelled = true; if (loaded) disposeScene(loaded.root); };
  }, [metaKey, cacheKey, entry]);
  return (
    <div className="absolute inset-0">
      <Canvas frameloop={active ? 'always' : 'never'} camera={{ position: [0, 0.15, 3.2], fov: 40 }} dpr={1}
        gl={{ alpha: true, preserveDrawingBuffer: true }}>
        <StudioLight />
        <hemisphereLight args={['#ffffff', '#3a3a3a', 0.5]} />
        <directionalLight position={[-3, 4, 3]} intensity={1.4} />
        <directionalLight position={[3, 2, -3]} intensity={0.8} color="#a6c7ff" />
        {prop && <PropModel prop={prop} turn={turn} />}
        <OrbitControls makeDefault enablePan={false} enableDamping minDistance={1.2} maxDistance={6} />
      </Canvas>
      {status !== 'ready' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        {status === 'loading'
          ? <Loader2 className="h-6 w-6 animate-spin text-text-secondary" aria-label={t('foundry.skin.loading')} />
          : <p className="text-center text-xs text-text-secondary">{t('installed.preview.unavailable')}</p>}
      </div>}
    </div>
  );
}
