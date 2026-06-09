import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';
import { getSoulModelInfo, exportSoulModel } from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';

/**
 * Live 3D preview of a soul-container mod, for the Locker's Global view.
 *
 * Soul containers are small static props; this is a deliberately minimal,
 * non-interactive auto-orbit viewer. The GLB is produced on demand by the
 * bundled `vpkmerge model export` (exportSoulModel) and served from the user's
 * library via the privileged `grimoire-soul:` scheme.
 *
 * Loading uses three's GLTFLoader directly (no @react-three/drei): each card
 * loads its own GLB once, so there is no shared cache to clone around and the
 * scene is disposed on unmount. This keeps the slice's dependencies to `three`
 * + `@react-three/fiber`.
 *
 * The whole Locker card is the enable/disable control, so this overlay is
 * pointer-events-none; clicks pass through to toggle the mod. On any failure it
 * renders nothing, leaving the card's clear window.
 */

const SOUL_MODEL_SCHEME = 'grimoire-soul';

function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key is a mod metaKey (overflow mods carry a '/', which a standard
  // scheme forbids in the host), so carry it as a single encoded path segment
  // under a fixed `m` host.
  return `${SOUL_MODEL_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
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

/** The static prop, normalized to a unit size and centered, slowly spinning. */
function OrbitingModel({ scene }: { scene: THREE.Object3D }) {
  const groupRef = useRef<THREE.Group>(null);

  // Normalize by the largest dimension so tall and wide props both fit the
  // small card frame, and recenter on the origin.
  const norm = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 1.7 / maxDim : 1;
    return { scale, center };
  }, [scene]);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.5;
  });

  return (
    <group ref={groupRef} scale={norm.scale}>
      <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

export default function SoulContainerViewer({
  modKey,
}: {
  /** The mod's metaKey: the collision-safe storage/URL key and the source the
   *  main process resolves and exports from. Folder-qualified for overflow
   *  mods (`addons{N}/<file>`), a bare filename for base-addons/.disabled. */
  modKey: string;
}) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Each Locker card mounts its own viewer (keyed by mod), so modKey is
    // stable for an instance and initial state needs no reset here.
    let cancelled = false;
    let loaded: THREE.Object3D | null = null;

    (async () => {
      try {
        let info = await getSoulModelInfo(modKey);
        if (!info.hasModel) {
          if (cancelled) return;
          setGenerating(true);
          info = await exportSoulModel(modKey);
          if (cancelled) return;
          setGenerating(false);
        }
        if (!info.hasModel) {
          if (!cancelled) setFailed(true);
          return;
        }
        const url = meshUrlFor(modKey, info.mtimeMs);
        const gltf = await loadGltfPreview(url);
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
  }, [modKey]);

  // Failure: render nothing so the card's clear window shows.
  if (failed) return null;

  if (!scene) {
    // Exporting (or first stat): a subtle spinner.
    return generating ? (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
        <Loader2 className="h-5 w-5 animate-spin text-white/80" />
      </div>
    ) : null;
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <Canvas camera={{ position: [0, 0.35, 3], fov: 35 }} dpr={1} gl={{ alpha: true }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[3, 5, 2]} intensity={1.3} />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        <OrbitingModel scene={scene} />
      </Canvas>
    </div>
  );
}
