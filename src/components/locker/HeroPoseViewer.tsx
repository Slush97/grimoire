import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRCubeTextureLoader } from 'three/examples/jsm/loaders/HDRCubeTextureLoader.js';
import { Loader2 } from 'lucide-react';
import { getAssetPath } from '../../lib/assetPath';
import {
  getHeroPoseInfo,
  exportHeroPose,
  getRiggedHeroPose,
  exportRiggedHeroPose,
  previewTrippySprite,
} from '../../lib/api';
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

// Six faces of a real Deadlock skybox IBL probe (the overcast probe: bright and
// neutral, not the moody dusk one), baked from the game's HDR cubemap to Radiance
// .hdr by `vpkmerge cubemap`. Order is the loader's expected [+X, -X, +Y, -Y, +Z,
// -Z]. Image-based lighting from this makes metallic and glossy surfaces read like
// in-game instead of dead-flat under bare directionals.
const IBL_FACES = [
  getAssetPath('/ibl/px.hdr'),
  getAssetPath('/ibl/nx.hdr'),
  getAssetPath('/ibl/py.hdr'),
  getAssetPath('/ibl/ny.hdr'),
  getAssetPath('/ibl/pz.hdr'),
  getAssetPath('/ibl/nz.hdr'),
];

// Rigged (animated, skinned) preview is gated OFF for now: the idle clip is WIP
// and too many heroes fall back to a default A-pose, so the static `--pose` menu
// pose stays the default. The rigged backend + viewer path remain in place; flip
// this to true to bring them back once the animation is improved.
const USE_RIGGED_PREVIEW: boolean = false;

// Turntable rotation rate (rad/s). The spin pauses while the user holds (orbits)
// the model with the mouse.
const SPIN_SPEED = 0.25;

function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key contains `::` (and a `/` for overflow skins), which a standard
  // scheme forbids in the host, so carry it as a single encoded path segment
  // under a fixed `m` host.
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
}

function riggedMeshUrlFor(key: string, mtimeMs: number | null): string {
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/model-rigged.glb?v=${mtimeMs ?? 0}`;
}

/** Free a loaded scene's GPU resources (geometry, materials, textures,
 *  skeletons). */
function disposeScene(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      // Releases the bone texture / internal buffers held by the skeleton.
      skinned.skeleton.dispose?.();
    }
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

/** Enable per-vertex COLOR multiply wherever the attribute exists. Pure
 *  read/write of an existing material flag, so material identity is untouched
 *  (the NPR CustomShaderMaterial wrap still finds the same instances). */
function enableVertexColors(scene: THREE.Object3D): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.color) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && !sm.vertexColors) {
        sm.vertexColors = true;
        sm.needsUpdate = true;
      }
    }
  });
}

/** Pick the idle clip to play. The export already ships exactly one clip
 *  (primary_stand_idle), so this is a thin guard: prefer the named idle, else
 *  the first non-trivial clip, else clip[0]; null if there are no clips at all
 *  (mesh-skin / clipless hero -> render skinned bind pose, no mixer). */
function pickIdleClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (clips.length === 0) return null;
  const named = clips.find((c) => c.name === 'primary_stand_idle' && c.duration > 0.001);
  if (named) return named;
  const animated = clips.find((c) => c.duration > 0.001);
  return animated ?? clips[0];
}

/** Shared pointer-interaction state between OrbitControls and the model group:
 *  the turntable pauses while `dragging`. A mutable ref so it updates without
 *  re-rendering. */
type TurntableInteraction = { dragging: boolean };

/** Slow turntable auto-rotation on the model group, paused while the user holds
 *  (orbits) the model with the mouse. */
function useTurntable(
  groupRef: RefObject<THREE.Group | null>,
  interaction: RefObject<TurntableInteraction>
): void {
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g || interaction.current.dragging) return;
    g.rotation.y += delta * SPIN_SPEED;
  });
}

/** The posed figure, normalized to a consistent height and centered, with a
 *  slow idle turntable. */
function PosedModel({
  scene,
  interaction,
}: {
  scene: THREE.Object3D;
  interaction: RefObject<TurntableInteraction>;
}) {
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

  // Per-vertex COLOR multiply where present (skin tone / accents render flat
  // white without it); see enableVertexColors.
  useEffect(() => {
    enableVertexColors(scene);
  }, [scene]);

  useTurntable(groupRef, interaction);

  return (
    <group ref={groupRef} scale={norm.scale}>
      <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

/** The skinned figure, idle clip driven by an AnimationMixer. gltf.scene is
 *  rendered AS-IS under wrapper groups so the SkinnedMesh's bone references stay
 *  valid (no reparenting, no clone). The normalize box is computed ONCE from the
 *  bind pose so the model does not breathe/drift as the clip plays. */
function RiggedModel({
  scene,
  clips,
  interaction,
}: {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  interaction: RefObject<TurntableInteraction>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // Normalize from the BIND/rest pose, once. Force the skeleton to bind pose and
  // flush world matrices first so the AABB is the true rest extent and does not
  // change frame to frame.
  const norm = useMemo(() => {
    scene.traverse((obj) => {
      const s = obj as THREE.SkinnedMesh;
      if (s.isSkinnedMesh && s.skeleton) s.skeleton.pose();
    });
    scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 2.0 / maxDim : 1;
    return { scale, center };
  }, [scene]);

  useEffect(() => {
    enableVertexColors(scene);
  }, [scene]);

  // Build the mixer + play the idle clip once per scene. Kept in a ref so React
  // re-renders never restart playback.
  useEffect(() => {
    const clip = pickIdleClip(clips);
    if (!clip) return; // no clip -> stays at bind pose (still a valid render).
    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.reset().play();
    return () => {
      action.stop();
      mixer.stopAllAction();
      mixer.uncacheClip(clip);
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
    };
  }, [scene, clips]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  useTurntable(groupRef, interaction);

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
function Controls({ interaction }: { interaction: RefObject<TurntableInteraction> }) {
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
    // Pause the turntable while held; kick a wobble on release (maglev feel).
    const onStart = () => {
      interaction.current.dragging = true;
    };
    const onEnd = () => {
      interaction.current.dragging = false;
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, gl, interaction]);
  // enableDamping requires update() every frame: without it the inertial glide
  // after a drag never runs (and on some three builds the orbit barely tracks).
  // R3F's default frameloop renders every frame, so this update() always runs.
  useFrame(() => controlsRef.current?.update());
  return null;
}

/** Image-based lighting from the baked Deadlock dusk probe. Loads the six .hdr
 *  faces once, runs them through PMREM, and assigns the result as
 *  `scene.environment` so every MeshStandardMaterial gets real reflections and
 *  ambient instead of dead-flat directional-only shading. The PMREM target is
 *  bound to this Canvas's GL context, so it is generated per-mount (the per-hero
 *  view shows a single viewer); SoulContainerViewer would want a shared probe. */
function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let disposed = false;
    const pmrem = new THREE.PMREMGenerator(gl);
    let envRT: THREE.WebGLRenderTarget | null = null;
    new HDRCubeTextureLoader()
      .setDataType(THREE.HalfFloatType)
      .load(IBL_FACES, (cube) => {
        if (disposed) {
          cube.dispose();
          pmrem.dispose();
          return;
        }
        envRT = pmrem.fromCubemap(cube);
        scene.environment = envRT.texture;
        cube.dispose();
        pmrem.dispose();
      });
    return () => {
      disposed = true;
      scene.environment = null;
      envRT?.dispose();
    };
  }, [gl, scene]);
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
  const { t } = useTranslation();
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [clips, setClips] = useState<THREE.AnimationClip[]>([]);
  const [rigged, setRigged] = useState(false);
  const [generating, setGenerating] = useState(false);
  const interaction = useRef<TurntableInteraction>({ dragging: false });
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
        // --- Attempt 1: rigged (animated, skinned) glb. Gated OFF for now: the
        //     idle anim is WIP and too many heroes fall back to A-pose, so the
        //     static --pose menu pose (Attempt 2) is the default. ---
        if (USE_RIGGED_PREVIEW) {
          try {
            let rig = await getRiggedHeroPose(heroName, skinSources);
            if (cancelled) return;
            if (!rig.hasModel) {
              setGenerating(true);
              rig = await exportRiggedHeroPose(heroName, skinSources, fallbackSkinMetaKey);
              if (cancelled) return;
              setGenerating(false);
            }
            if (rig.hasModel) {
              const url = riggedMeshUrlFor(rig.key, rig.mtimeMs);
              const gltf = await loadGltfPreview(url);
              if (cancelled) {
                disposeScene(gltf.scene);
                return;
              }
              loaded = gltf.scene;
              setClips(gltf.animations ?? []);
              setRigged(true);
              setScene(gltf.scene);
              return; // rigged path won.
            }
          } catch {
            // Rigged export/load failed; fall through to the static pose path.
            setGenerating(false);
          }
        }

        // --- Attempt 2: static --pose glb (the default). ---
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
        setRigged(false);
        setClips([]);
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
          {t('locker.pose.cannotPose')}
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
            {skinSources.length > 1
              ? t('locker.pose.posingWithMods', { hero: heroName, count: skinSources.length })
              : t('locker.pose.posing', { hero: heroName })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0, 0, 3.2], fov: 40 }}
        dpr={[1, 2]}
        gl={{
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.8,
        }}
      >
        {/* The IBL probe supplies ambient + reflections, so the bare ambientLight
            is gone and the directionals are softened to a warm key + cool fill
            that just shapes the form on top of the environment. */}
        <Environment />
        <ambientLight intensity={0.12} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} color="#fff3e0" />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#cfe0ff" />
        {rigged ? (
          <RiggedModel scene={scene} clips={clips} interaction={interaction} />
        ) : (
          <PosedModel scene={scene} interaction={interaction} />
        )}
        {trippySprite && <TrippyPaint scene={scene} sprite={trippySprite} />}
        <Controls interaction={interaction} />
      </Canvas>
    </div>
  );
}
