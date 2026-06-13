import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Loader2 } from 'lucide-react';
import { getHeroPoseInfo, exportHeroPose, previewTrippySprite } from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import type { HeroPoseSkinSource } from '../../types/portrait';
import type { TrippySpriteResult } from '../../types/mod';
import type { TrippyPreview } from '../../stores/trippyPreviewStore';

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

/** Live trippy-skin preview: paints the body meshes with the trippy pattern and
 *  animates it. The sprite from `previewTrippySprite` is a horizontal frame
 *  strip (the same asset the 2D swatch flipbooks); we draw the current frame
 *  onto an offscreen canvas and feed it as a tiling CanvasTexture, so the paint
 *  flows on the model. This is an approximation of the engine's UV-scroll shader
 *  (body only; the GLB carries no weapon mesh), not the exact bake.
 *
 *  Originals are captured per material and restored on unmount, so toggling the
 *  preview off (or closing the panel) returns the model to its real skin. */
function TrippyPaint({
  scene,
  sprite,
  fps = 12,
  repeat = 2,
}: {
  scene: THREE.Object3D;
  sprite: TrippySpriteResult;
  fps?: number;
  repeat?: number;
}) {
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const startRef = useRef<number | null>(null);
  const lastFrameRef = useRef(-1);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = sprite.size;
    canvas.height = sprite.size;
    canvasRef.current = canvas;

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    texRef.current = tex;

    const img = new Image();
    img.src = sprite.dataUrl;
    imgRef.current = img;

    // Unique materials so meshes sharing one material are touched once.
    const originals = new Map<THREE.MeshStandardMaterial, { map: THREE.Texture | null; color: number }>();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm || originals.has(sm)) continue;
        originals.set(sm, { map: sm.map ?? null, color: sm.color?.getHex() ?? 0xffffff });
        sm.map = tex;
        sm.color?.setHex(0xffffff);
        sm.needsUpdate = true;
      }
    });

    return () => {
      for (const [sm, original] of originals) {
        sm.map = original.map;
        sm.color?.setHex(original.color);
        sm.needsUpdate = true;
      }
      originals.clear();
      tex.dispose();
      startRef.current = null;
      lastFrameRef.current = -1;
    };
  }, [scene, sprite, repeat]);

  useFrame((state) => {
    const tex = texRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!tex || !canvas || !img || !img.complete || img.naturalWidth === 0) return;
    const now = state.clock.elapsedTime;
    if (startRef.current === null) startRef.current = now;
    const frame = Math.floor((now - startRef.current) * fps) % sprite.frames;
    if (frame === lastFrameRef.current) return;
    lastFrameRef.current = frame;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      img,
      frame * sprite.size,
      0,
      sprite.size,
      sprite.size,
      0,
      0,
      sprite.size,
      sprite.size
    );
    tex.needsUpdate = true;
  });

  return null;
}

const q = (x: number): number => Math.round(x * 100) / 100;

export default function HeroPoseViewer({
  heroName,
  skinSources = [],
  fallbackSkinMetaKey,
  trippyPreview,
}: {
  heroName: string;
  /** Active visual VPK stack for this hero, ordered by the main process before export. */
  skinSources?: HeroPoseSkinSource[];
  /** Single-skin fallback when a multi-source preview stack cannot be exported. */
  fallbackSkinMetaKey?: string;
  /** Live Body + Gun trippy params to paint on the body in real time, or
   *  undefined for the plain skin. */
  trippyPreview?: TrippyPreview;
}) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const sourceKey = skinSources.map((source) => `${source.priority}:${source.metaKey}`).join('|');

  // The pose GLB has no weapon mesh, so a weapons-only paint has nothing to show
  // here, and intensity 0 is "no paint". Otherwise fetch the pattern as an
  // animated sprite strip (debounced) and flipbook it onto the body materials.
  const showTrippy =
    !!trippyPreview && trippyPreview.targets !== 'weapons' && trippyPreview.intensity > 0;
  const trippyKey = showTrippy
    ? `${trippyPreview.style}:${q(trippyPreview.intensity)}:${q(trippyPreview.phase)}:${q(trippyPreview.scroll)}`
    : null;
  const [trippySprite, setTrippySprite] = useState<TrippySpriteResult | null>(null);
  useEffect(() => {
    if (!showTrippy || !trippyPreview) {
      setTrippySprite(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      previewTrippySprite({
        style: trippyPreview.style,
        phase: q(trippyPreview.phase),
        scroll: q(trippyPreview.scroll),
        intensity: q(trippyPreview.intensity),
        frames: 24,
        size: 128,
      })
        .then((sprite) => {
          if (!cancelled) setTrippySprite(sprite);
        })
        .catch(() => {
          if (!cancelled) setTrippySprite(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // trippyKey encodes the params that change the sprite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trippyKey]);

  useEffect(() => {
    // The caller remounts this component (via a hero+skin `key`) when the
    // selection changes, so initial state is already fresh here.
    let cancelled = false;
    let loaded: THREE.Object3D | null = null;

    (async () => {
      try {
        let info = await getHeroPoseInfo(heroName, skinSources);
        if (!info.hasModel) {
          if (cancelled) return;
          setGenerating(true);
          info = await exportHeroPose(heroName, skinSources, fallbackSkinMetaKey);
          if (cancelled) return;
          setGenerating(false);
        }
        if (!info.hasModel) {
          if (!cancelled) setFailed(true);
          return;
        }
        const url = meshUrlFor(info.key, info.mtimeMs);
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
    // `skinSources` is deliberately not a dependency: `sourceKey` already
    // encodes its contents, and the array reference changes on every parent
    // mods refresh, which would tear down and re-fetch the GLB for an
    // identical stack (visible viewer churn on unrelated toggles).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroName, sourceKey, fallbackSkinMetaKey]);

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
          <p className="text-xs text-text-secondary">
            Posing {heroName}
            {skinSources.length > 1 ? ` with ${skinSources.length} active mods` : ''}...
          </p>
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
        {trippySprite && <TrippyPaint scene={scene} sprite={trippySprite} />}
        <Controls />
      </Canvas>
    </div>
  );
}
