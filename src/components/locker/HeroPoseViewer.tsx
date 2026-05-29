import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Loader2 } from 'lucide-react';
import { getHeroPoseInfo, exportHeroPose } from '../../lib/api';

/**
 * Live 3D preview of a hero's menu pose for the Locker's per-hero view.
 *
 * The GLB is a static posed still produced on demand by the bundled
 * `vpkmerge model export --pose` (exportHeroPose) and served from the user's
 * library via the privileged `grimoire-hero:` scheme. It carries no skeleton,
 * skin, or clips and has the toon-outline / glow halo shells stripped, so it
 * loads as plain meshes (no SkinnedMesh, no skin-strip needed here).
 *
 * Interactive: drag to orbit, scroll to zoom. Loading uses three's GLTFLoader
 * directly (no @react-three/drei): each mount loads its own GLB once and
 * disposes the scene on unmount.
 */

const HERO_POSE_SCHEME = 'grimoire-hero';

function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key contains `::` (and a `/` for overflow skins), which a standard
  // scheme forbids in the host, so carry it as a single encoded path segment
  // under a fixed `m` host.
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
}

/** Free a loaded scene's GPU resources (geometry, materials, textures). */
function disposeScene(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      [sm.map, sm.normalMap, sm.roughnessMap, sm.metalnessMap, sm.emissiveMap, sm.aoMap].forEach(
        (t) => t?.dispose()
      );
      m?.dispose();
    }
  });
}

/** The posed figure, normalized to a consistent height and centered, with a
 *  slow idle turntable. */
function PosedModel({ scene }: { scene: THREE.Object3D }) {
  const groupRef = useRef<THREE.Group>(null);

  // Normalize by the largest dimension so every hero fills the frame the same
  // regardless of native model scale, and recenter on the origin.
  const norm = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 2.0 / maxDim : 1;
    return { scale, center };
  }, [scene]);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.25;
  });

  return (
    <group ref={groupRef} scale={norm.scale}>
      <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

/** Mouse orbit + zoom, damped. Auto-rotation lives on the model group so the
 *  controls don't fight it; dragging just reorients the camera. */
function Controls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 6;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;
    return () => {
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, gl]);
  // enableDamping requires update() every frame: without it the inertial glide
  // after a drag never runs (and on some three builds the orbit barely tracks).
  // The frame loop is already alive from PosedModel's turntable useFrame.
  useFrame(() => controlsRef.current?.update());
  return null;
}

export default function HeroPoseViewer({
  heroName,
  skinMetaKey,
}: {
  heroName: string;
  /** metaKey of the hero's active skin VPK; omit for a vanilla pose. */
  skinMetaKey?: string;
}) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // The caller remounts this component (via a hero+skin `key`) when the
    // selection changes, so initial state is already fresh here.
    let cancelled = false;
    let loaded: THREE.Object3D | null = null;

    (async () => {
      try {
        let info = await getHeroPoseInfo(heroName, skinMetaKey);
        if (!info.hasModel) {
          if (cancelled) return;
          setGenerating(true);
          info = await exportHeroPose(heroName, skinMetaKey);
          if (cancelled) return;
          setGenerating(false);
        }
        if (!info.hasModel) {
          if (!cancelled) setFailed(true);
          return;
        }
        const url = meshUrlFor(info.key, info.mtimeMs);
        const gltf = await new Promise<GLTF>((resolve, reject) => {
          new GLTFLoader().load(url, resolve, undefined, reject);
        });
        if (cancelled) {
          disposeScene(gltf.scene);
          return;
        }
        loaded = gltf.scene;
        setScene(gltf.scene);
      } catch {
        if (!cancelled) {
          setGenerating(false);
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loaded) disposeScene(loaded);
    };
  }, [heroName, skinMetaKey]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="max-w-xs text-center text-sm text-text-secondary">
          This hero can&apos;t be posed in 3D yet.
        </p>
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-white/80" />
        {generating && (
          <p className="text-xs text-text-secondary">Posing {heroName}...</p>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <Canvas camera={{ position: [0, 0, 3.2], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={1.4} />
        <directionalLight position={[-4, 2, -3]} intensity={0.6} />
        <PosedModel scene={scene} />
        <Controls />
      </Canvas>
    </div>
  );
}
