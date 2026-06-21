import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls as DreiOrbitControls } from '@react-three/drei';
import { Leva, folder, useControls } from 'leva';
import * as THREE from 'three';
import { HDRCubeTextureLoader } from 'three/examples/jsm/loaders/HDRCubeTextureLoader.js';
import { Loader2 } from 'lucide-react';
import { getAssetPath } from '../../lib/assetPath';
import {
  getHeroPoseInfo,
  exportHeroPose,
  getRiggedHeroPose,
  exportRiggedHeroPose,
  getHeroClothModel,
  getHeroEffectInfo,
  exportHeroEffect,
  previewTrippySprite,
} from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import { ParticleEffect } from './ParticleEffect';
import type { FxDescriptor } from './fxDescriptor';
import { useClothSim } from '../../lib/useClothSim';
import type { ClothModel } from '../../lib/feModel';
import { BloomEffect } from './BloomEffect';
import {
  isNprMaterial,
  isSelfIllumMaterial,
  wrapMaterialWithNpr,
  buildOutlineShell,
  unwrapNprBase,
  summarizeNprScene,
  applySource2MaterialHints,
  getMorphic,
  flag,
  type NprWrapResult,
  type MorphicExtras,
  type MorphicDynamicExpr,
} from '../../lib/source2NprMaterial';
import { buildDeadlockMaterial, type DeadlockMaterialResult } from '../../lib/deadlockMaterial';
import { resolveHeroPoseRenderFeatures } from './heroPoseRenderFeatures';
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
 * Interactive: drag to orbit, scroll to zoom. Loading stays on the custom
 * GLTFLoader helper because Source 2 morphic texture resolution needs the live
 * gltf.parser and ImageBitmap suppression window.
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

const USE_CLOTH: boolean = false;

// Source 2 NPR cel/rim/tint restyle layered on top of the PMREM IBL + ACES
// tonemap output (not a replacement pass). Gated per-material on userData.morphic
// + F_USE_NPR_LIGHTING, so heroes/materials without that data keep their base path.
const USE_NPR_PREVIEW: boolean = false;

// Inverted-hull solid-color outline (Source 2's method; vpkmerge strips the
// engine shells from the export, so we regenerate them). Honors per-material
// outline data.
const USE_NPR_OUTLINE: boolean = false;

// Bloom postprocessing gives self-illum glows their bright-core + colored-halo look.
const USE_BLOOM: boolean = true;
// UnrealBloomPass starting params. Threshold is in LINEAR space, so it mainly catches
// the capped self-illum (peak ~ selfIllumCap) and the brightest speculars, not the
// whole hero. All three are calibration knobs - tune against a glowing hero.
const BLOOM_INTENSITY = 1;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.85;

// Broader Source 2 material approximations for shader-heavy heroes.
const USE_SOURCE2_SHADER_HINTS: boolean = false;

// Unified single build pass (deadlockMaterial.buildDeadlockMaterial): collapses
// the Source2 hints + NPR CSM two-pass into one pass on an owned clone of each
// material, so the GLTF base is never mutated.
const USE_UNIFIED_MATERIAL: boolean = true;

// Phase 5 shader experiment: quantize accumulated direct diffuse at
// lights_fragment_end, leaving IBL unbanded.
const USE_CEL_V2: boolean = true;

// Ambient particle FX overlay stays off. It is separate from shader/material work.
const USE_EFFECT_PREVIEW: boolean = false;

const RELEASE_RENDER_FLAGS = {
  npr: USE_NPR_PREVIEW,
  nprOutline: USE_NPR_OUTLINE,
  source2: USE_SOURCE2_SHADER_HINTS,
  unified: USE_UNIFIED_MATERIAL,
  celV2: USE_CEL_V2,
  cloth: USE_CLOTH,
  bloom: USE_BLOOM,
  nprDebug: false,
  matDebug: false,
};

type DevPreviewFlags = typeof RELEASE_RENDER_FLAGS & {
  effects: boolean;
};

type BloomParams = {
  intensity: number;
  radius: number;
  threshold: number;
};

const COMPACT_LEVA_THEME = {
  sizes: {
    rootWidth: '248px',
    controlWidth: '104px',
    rowHeight: '22px',
    folderTitleHeight: '22px',
    checkboxSize: '14px',
    titleBarHeight: '24px',
    numberInputMinWidth: '42px',
    scrubberHeight: '10px',
  },
  space: {
    xs: '2px',
    sm: '4px',
    md: '6px',
    rowGap: '2px',
    colGap: '5px',
  },
  fontSizes: {
    root: '10px',
  },
  radii: {
    sm: '3px',
    lg: '5px',
  },
};

function previewFlag(name: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(name);
  if (raw === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function writePreviewFlag(name: string, value: boolean): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(name, value ? '1' : '0');
}

function effectDescriptorUrl(key: string): string {
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/effect.json`;
}

function effectTextureBaseUrl(key: string): string {
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/effect-tex/`;
}

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
  const disposedMaterials = new Set<THREE.Material>();
  const disposeMaterial = (m: THREE.Material | null | undefined): void => {
    if (!m || disposedMaterials.has(m)) return;
    disposedMaterials.add(m);
    const sm = m as THREE.MeshStandardMaterial;
    [sm.map, sm.normalMap, sm.roughnessMap, sm.metalnessMap, sm.emissiveMap, sm.aoMap].forEach(
      (t) => t?.dispose()
    );
    const resolved = getMorphic(m)?.resolvedTextures;
    if (resolved) {
      Object.values(resolved).forEach((t) => t.dispose());
    }
    const csmBase = (m as { __csm?: { baseMaterial?: THREE.Material } }).__csm?.baseMaterial;
    if (csmBase && csmBase !== m) disposeMaterial(csmBase);
    m.dispose();
  };

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
      disposeMaterial(m);
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

/** Pick the rigged clip to play. The backend should ship exactly one animated
 *  clip; null means reject this rigged GLB and use the static pose path. */
function pickIdleClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  return clips.find((c) => c.duration > 0.001) ?? null;
}

/** Shared pointer-interaction state between OrbitControls and the model group:
 *  the turntable pauses while `dragging`. A mutable ref so it updates without
 *  re-rendering. */
export type TurntableInteraction = { dragging: boolean; paused: boolean };

type ViewerText = (key: string, options?: Record<string, unknown>) => string;

export function HeroPoseFailureState({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="max-w-xs text-center text-sm text-text-secondary">{message}</p>
    </div>
  );
}

export function HeroPoseLoadingState({
  generating,
  heroName,
  skinSourceCount,
  t,
}: {
  generating: boolean;
  heroName: string;
  skinSourceCount: number;
  t: ViewerText;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-white/80" />
      {generating && (
        <p className="text-xs text-text-secondary">
          {skinSourceCount > 1
            ? t('locker.pose.posingWithMods', { hero: heroName, count: skinSourceCount })
            : t('locker.pose.posing', { hero: heroName })}
        </p>
      )}
    </div>
  );
}

/** Slow turntable auto-rotation on the model group, paused while the user holds
 *  (orbits) the model with the mouse. */
function useTurntable(
  groupRef: RefObject<THREE.Group | null>,
  interaction: RefObject<TurntableInteraction>
): void {
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g || interaction.current.dragging || interaction.current.paused) return;
    g.rotation.y += delta * SPIN_SPEED;
  });
}

/** The posed figure, normalized to a consistent height and centered, with a
 *  slow idle turntable. */
export function PosedModel({
  scene,
  interaction,
  effect,
}: {
  scene: THREE.Object3D;
  interaction: RefObject<TurntableInteraction>;
  effect?: EffectMount | null;
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
        {effect && (
          <ParticleEffect descriptor={effect.descriptor} textureBaseUrl={effect.baseUrl} />
        )}
      </group>
    </group>
  );
}

/** The descriptor + bundled-texture base URL for the ambient FX overlay mounted
 *  inside a model's normalized group (so it shares the preview scale/centering). */
interface EffectMount {
  descriptor: FxDescriptor;
  baseUrl: string;
}

/** The skinned figure, idle clip driven by an AnimationMixer. gltf.scene is
 *  rendered AS-IS under wrapper groups so the SkinnedMesh's bone references stay
 *  valid (no reparenting, no clone). The normalize box is computed ONCE from the
 *  bind pose so the model does not breathe/drift as the clip plays. */
function RiggedModel({
  scene,
  clips,
  interaction,
  clothModel,
  clothEnabled,
  effect,
}: {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  interaction: RefObject<TurntableInteraction>;
  clothModel: ClothModel | null;
  clothEnabled: boolean;
  effect?: EffectMount | null;
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
    if (!clip) return;
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

  // Cloth bones swing under gravity + turntable inertia, AFTER the mixer poses
  // the skeleton, and collide with the body capsules/spheres from the FeModel
  // sidecar (null on a model with no cloth -> the sim no-ops).
  const clothStep = useClothSim(scene, clothEnabled ? clothModel : null);
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
    clothStep(delta);
  });

  useTurntable(groupRef, interaction);

  return (
    <group ref={groupRef} scale={norm.scale}>
      <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
        <primitive object={scene} />
        {effect && (
          <ParticleEffect descriptor={effect.descriptor} textureBaseUrl={effect.baseUrl} />
        )}
      </group>
    </group>
  );
}

/** Mouse orbit + zoom, damped. Auto-rotation lives on the model group so the
 *  controls don't fight it; dragging just reorients the camera. */
function Controls({ interaction }: { interaction: RefObject<TurntableInteraction> }) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<ComponentRef<typeof DreiOrbitControls> | null>(null);
  useEffect(() => {
    // Dolly toward/away from the target in any state, clamped to min/max distance.
    const onWheel = (e: WheelEvent) => {
      const controls = controlsRef.current;
      if (!controls) return;
      e.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const dist = THREE.MathUtils.clamp(
        offset.length() * (e.deltaY > 0 ? 1.1 : 1 / 1.1),
        controls.minDistance,
        controls.maxDistance
      );
      camera.position.copy(controls.target).add(offset.setLength(dist));
    };
    gl.domElement.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      gl.domElement.removeEventListener('wheel', onWheel);
    };
  }, [camera, gl]);

  return (
    <DreiOrbitControls
      ref={controlsRef}
      enableDamping
      enablePan
      enableZoom={false}
      minDistance={1.6}
      maxDistance={6}
      target={[0, 0, 0]}
      onStart={() => {
        // eslint-disable-next-line react-hooks/immutability -- ref.current mutation is the sanctioned React pattern; `interaction` is a RefObject, not immutable hook state
        interaction.current.dragging = true;
      }}
      onEnd={() => {
        // eslint-disable-next-line react-hooks/immutability -- ref.current mutation is the sanctioned React pattern; `interaction` is a RefObject, not immutable hook state
        interaction.current.dragging = false;
      }}
    />
  );
}

/** Image-based lighting from the baked Deadlock dusk probe. Loads the six .hdr
 *  faces once, runs them through PMREM, and assigns the result as
 *  `scene.environment` so every MeshStandardMaterial gets real reflections and
 *  ambient instead of dead-flat directional-only shading. The PMREM target is
 *  bound to this Canvas's GL context, so it is generated per-mount (the per-hero
 *  view shows a single viewer); SoulContainerViewer would want a shared probe.
 *  Drei Environment is not used here: the viewer needs HDRCubeTextureLoader's
 *  six-face Radiance cubemap path and HalfFloat PMREM for the Deadlock IBL. */
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

/** Wraps every NPR-eligible material in `scene` with a CSM that layers the
 *  Deadlock cel ramp + rim + tint mask on the lit PBR output. Side-effects the
 *  shared scene graph in place (like the model effects / TrippyPaint), so one
 *  instance serves both PosedModel and RiggedModel (both render the same scene).
 *  Restores originals and disposes its CSM wrappers + mask clones on cleanup.
 *  No-op when disabled or when no material carries morphic data. */
function NprMaterials({
  scene,
  enabled,
  outline,
  tint,
  unified,
  source2Active,
  celV2,
}: {
  scene: THREE.Object3D;
  enabled: boolean;
  outline: boolean;
  tint: THREE.Color | null;
  /** When true, build each material via the unified single pass
   *  (buildDeadlockMaterial) instead of the old applySource2MaterialHints +
   *  wrapMaterialWithNpr two-pass. */
  unified: boolean;
  /** Forces legacy wraps to rebuild after the mutating Source2 hint pass changes. */
  source2Active: boolean;
  celV2: boolean;
}) {
  // Live handle to the builds so the tint effect + uTime ticker can poke uniforms
  // without a rebuild. Both paths expose { material, uniforms } so the per-frame /
  // tint effects below are path-agnostic.
  const buildsRef = useRef<
    Map<
      THREE.Material,
      {
        material: THREE.Material;
        uniforms: Record<string, THREE.IUniform>;
        selfIllumScaleFn?: ((t: number) => number) | null;
      }
    >
  >(new Map());

  useEffect(() => {
    if (!enabled) return;
    const builds = new Map<
      THREE.Material,
      {
        material: THREE.Material;
        uniforms: Record<string, THREE.IUniform>;
        selfIllumScaleFn?: ((t: number) => number) | null;
      }
    >();
    // Per-build teardown (dispose the owned CSM/clone/masks). On the unified path
    // this is the build's own dispose(); on the legacy path it mirrors the old
    // CSM + ownedTextures dispose.
    const disposers: Array<() => void> = [];
    const restore: Array<() => void> = [];

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const skinned = obj as THREE.SkinnedMesh;
      if (!mesh.isMesh && !skinned.isSkinnedMesh) return;

      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((mat, i) => {
        if (!mat) return;
        // NPR materials always; on the unified path also non-NPR self-illum
        // materials (familiar eyes) - they get the glow with cel/rim disabled.
        if (!isNprMaterial(mat) && !(unified && isSelfIllumMaterial(mat))) return;
        // Idempotency: legacy CSM stamps `__csm` on the base it wraps. Unified
        // wraps an owned clone, so per-pass dedup is handled by the builds map.
        if (!unified && (mat as { __csm?: unknown }).__csm) return;

        let b = builds.get(mat);
        if (!b) {
          if (unified) {
            // ONE pass: state + CSM on an owned clone; base is never mutated.
            const built: DeadlockMaterialResult = buildDeadlockMaterial(mat, undefined, tint);
            built.uniforms.uCelV2.value = celV2 ? 1.0 : 0.0;
            b = {
              material: built.material,
              uniforms: built.uniforms,
              selfIllumScaleFn: built.selfIllumScaleFn,
            };
            builds.set(mat, b);
            disposers.push(built.dispose);
          } else {
            const built: NprWrapResult | null = wrapMaterialWithNpr(mat, undefined, tint);
            if (!built) return;
            built.uniforms.uCelV2.value = celV2 ? 1.0 : 0.0;
            b = { material: built.material, uniforms: built.uniforms };
            builds.set(mat, b);
            disposers.push(() => {
              built.material.dispose();
              built.ownedTextures.forEach((t) => t.dispose());
            });
          }
        }
        const next = b.material;
        if (Array.isArray(mesh.material)) {
          const arr = mesh.material;
          arr[i] = next;
          restore.push(() => {
            arr[i] = mat;
            // Legacy path mutates the base in place (onBeforeCompile / emissive),
            // so it must be reversed. The unified path never touched the base.
            if (!unified) unwrapNprBase(mat);
          });
        } else {
          mesh.material = next;
          restore.push(() => {
            mesh.material = mat;
            if (!unified) unwrapNprBase(mat);
          });
        }
      });

      if (outline) {
        const dispose = buildOutlineShell(mesh);
        if (dispose) restore.push(dispose);
      }
    });

    buildsRef.current = builds;

    return () => {
      // Restore the original mesh.material references first, then dispose only what
      // this effect created. The parent loader effect's disposeScene then disposes
      // the restored originals, so there is no double-free.
      restore.forEach((fn) => fn());
      disposers.forEach((fn) => fn());
      builds.clear();
      buildsRef.current = new Map();
    };
    // `tint` is intentionally excluded: the separate effect below applies it by
    // mutating uniforms, so a recolor never tears down and rebuilds the builds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, enabled, outline, unified, source2Active]);

  // Drive uTime for the self-illum UV scroll (viscous_head's liquid glow).
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    buildsRef.current.forEach((b) => {
      if (b.uniforms.uTime) b.uniforms.uTime.value = t;
      // Drive a dynamic self-illum scale (inferno body's 0.5*sin(3*time())+0.5);
      // static scales have no fn and keep their build-time uniform value.
      if (b.selfIllumScaleFn && b.uniforms.uSelfIllumScale) {
        const s = b.selfIllumScaleFn(t);
        // Guard: a future divergent expr could go NaN/Inf mid-stream; one bad
        // uniform write blows out the whole material.
        if (Number.isFinite(s)) b.uniforms.uSelfIllumScale.value = s;
      }
    });
  });

  // Live tint (ability-recolor preview): mutate uniforms only, no rebuild.
  useEffect(() => {
    if (!enabled) return;
    buildsRef.current.forEach((b) => {
      const u = b.uniforms.uTintColor.value as THREE.Color;
      if (tint) u.copy(tint);
      else u.setRGB(1, 1, 1);
    });
  }, [tint, enabled]);

  useEffect(() => {
    if (!enabled) return;
    buildsRef.current.forEach((b) => {
      if (b.uniforms.uCelV2) b.uniforms.uCelV2.value = celV2 ? 1.0 : 0.0;
    });
  }, [celV2, enabled]);

  return null;
}

function Source2MaterialHints({
  scene,
  enabled,
  debug,
  skipNpr,
}: {
  scene: THREE.Object3D;
  enabled: boolean;
  debug: boolean;
  skipNpr: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const hints = applySource2MaterialHints(
      scene,
      debug,
      skipNpr ? (mat) => !isNprMaterial(mat) : undefined
    );
    if (debug) console.info('[source2hints] summary', hints.stats);
    return () => hints.restore();
  }, [scene, enabled, debug, skipNpr]);

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
  const [clothModel, setClothModel] = useState<ClothModel | null>(null);
  const [generating, setGenerating] = useState(false);
  const interaction = useRef<TurntableInteraction>({ dragging: false, paused: false });
  const [spinPaused, setSpinPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [effect, setEffect] = useState<EffectMount | null>(null);
  const sourceKey = skinSources.map((source) => `${source.priority}:${source.metaKey}`).join('|');
  const [devFlags, setDevFlags] = useState<DevPreviewFlags>(() => ({
    ...RELEASE_RENDER_FLAGS,
    npr: previewFlag('grimoire.preview.npr', USE_NPR_PREVIEW),
    nprOutline: previewFlag('grimoire.preview.nprOutline', USE_NPR_OUTLINE),
    source2: previewFlag('grimoire.preview.source2Shaders', USE_SOURCE2_SHADER_HINTS),
    unified: previewFlag('grimoire.preview.unifiedMaterial', USE_UNIFIED_MATERIAL),
    celV2: previewFlag('grimoire.preview.celV2', USE_CEL_V2),
    cloth: previewFlag('grimoire.preview.cloth', USE_CLOTH),
    bloom: previewFlag('grimoire.preview.bloom', USE_BLOOM),
    effects: previewFlag('grimoire.preview.effects', USE_EFFECT_PREVIEW),
    nprDebug: previewFlag('grimoire.preview.nprDebug', false),
    matDebug: previewFlag('grimoire.preview.matDebug', false),
  }));
  const [bloomParams, setBloomParams] = useState<BloomParams>(() => ({
    intensity: BLOOM_INTENSITY,
    radius: BLOOM_RADIUS,
    threshold: BLOOM_THRESHOLD,
  }));
  const setDevFlag = useCallback((key: keyof DevPreviewFlags, storageKey: string, value: boolean) => {
    writePreviewFlag(storageKey, value);
    setDevFlags((current) => ({ ...current, [key]: value }));
  }, []);
  const activeRenderFlags = import.meta.env.DEV ? devFlags : RELEASE_RENDER_FLAGS;
  const effectPreviewEnabled = import.meta.env.DEV ? devFlags.effects : USE_EFFECT_PREVIEW;

  // The pose GLB has no weapon mesh, so a weapons-only paint has nothing to show
  // here, and intensity 0 is "no paint". Otherwise fetch the pattern as an
  // animated sprite strip (debounced) and flipbook it onto the body materials.
  const showTrippy =
    !!trippyPreview && trippyPreview.targets !== 'weapons' && trippyPreview.intensity > 0;
  const trippyKey = showTrippy
    ? `${trippyPreview.style}:${q(trippyPreview.intensity)}:${q(trippyPreview.phase)}:${q(trippyPreview.scroll)}`
    : null;
  const [trippySprite, setTrippySprite] = useState<TrippySpriteResult | null>(null);
  const features = resolveHeroPoseRenderFeatures(activeRenderFlags, !!trippySprite);
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
    setFailed(false);
    setScene(null);
    setClips([]);
    setRigged(false);
    setClothModel(null);

    (async () => {
      try {
        // --- Attempt 1: rigged (animated, skinned) glb. Gated OFF for now: the
        //     idle anim is WIP and too many heroes fall back to A-pose, so the
        //     static --pose menu pose (Attempt 2) is the default. ---
        if (features.riggedPreviewEnabled) {
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
              const clip = pickIdleClip(gltf.animations ?? []);
              if (!clip) {
                disposeScene(gltf.scene);
                throw new Error('Rigged preview GLB has no animated clip.');
              }
              loaded = gltf.scene;
              setClips([clip]);
              setRigged(true);
              setScene(gltf.scene);
              // Cloth-sim sidecar (colliders) for the rigged path. Best-effort:
              // a model with no cloth returns null and the sim simply no-ops.
              if (features.clothPreviewEnabled) {
                getHeroClothModel(heroName, skinSources).then((fe) => {
                  if (!cancelled) setClothModel(fe);
                });
              } else {
                setClothModel(null);
              }
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
        setClothModel(null); // static path has no skeleton; nothing to simulate.
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
  }, [
    heroName,
    sourceKey,
    fallbackSkinMetaKey,
    features.riggedPreviewEnabled,
    features.clothPreviewEnabled,
  ]);

  useEffect(() => {
    if (!scene || !features.nprDebugEnabled) return;
    console.info('[HeroPoseViewer] NPR material summary', heroName, summarizeNprScene(scene));
  }, [scene, heroName, features.nprDebugEnabled]);

  // Ambient FX overlay (skin-independent): only the curated heroes have one, so
  // getHeroEffectInfo cheaply returns hasEffect=false for everyone else. The
  // bundle is built on demand, then the descriptor JSON is fetched over the
  // grimoire-hero: scheme and handed to the renderer.
  useEffect(() => {
    if (!effectPreviewEnabled) return;
    let cancelled = false;
    setEffect(null);
    (async () => {
      try {
        let info = await getHeroEffectInfo(heroName);
        if (cancelled || !info.entry) return; // no curated effect for this hero.
        if (!info.hasEffect) {
          info = await exportHeroEffect(heroName);
          if (cancelled || !info.hasEffect) return;
        }
        const res = await fetch(effectDescriptorUrl(info.key));
        if (!res.ok) return;
        const descriptor = (await res.json()) as FxDescriptor;
        if (cancelled) return;
        setEffect({ descriptor, baseUrl: effectTextureBaseUrl(info.key) });
      } catch {
        // Effects are a non-essential overlay; a failure leaves the plain pose.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [heroName, effectPreviewEnabled]);

  if (failed) {
    return <HeroPoseFailureState message={t('locker.pose.cannotPose')} />;
  }

  if (!scene) {
    return (
      <HeroPoseLoadingState
        generating={generating}
        heroName={heroName}
        skinSourceCount={skinSources.length}
        t={t}
      />
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
          <RiggedModel
            scene={scene}
            clips={clips}
            interaction={interaction}
            clothModel={clothModel}
            clothEnabled={features.clothPreviewEnabled}
            effect={effect}
          />
        ) : (
          <PosedModel scene={scene} interaction={interaction} effect={effect} />
        )}
        {features.source2ShaderHintsEnabled && scene && (
          <Source2MaterialHints
            scene={scene}
            enabled={features.source2ShaderHintsEnabled}
            debug={features.nprDebugEnabled}
            skipNpr={features.source2SkipNpr}
          />
        )}
        {features.nprMaterialsEnabled && scene && (
          <NprMaterials
            scene={scene}
            enabled={features.nprMaterialsEnabled}
            outline={features.nprOutlineEnabled}
            tint={null /* wire to a recolor color once the Locker recolor surface exists */}
            unified={features.unifiedEnabled}
            source2Active={features.source2ShaderHintsEnabled}
            celV2={features.celV2Enabled}
          />
        )}
        {trippySprite && <TrippyPaint scene={scene} sprite={trippySprite} />}
        {features.bloomEnabled && (
          <BloomEffect
            intensity={import.meta.env.DEV ? bloomParams.intensity : BLOOM_INTENSITY}
            radius={import.meta.env.DEV ? bloomParams.radius : BLOOM_RADIUS}
            threshold={import.meta.env.DEV ? bloomParams.threshold : BLOOM_THRESHOLD}
          />
        )}
        <Controls interaction={interaction} />
      </Canvas>
      <button
        type="button"
        onClick={() => {
          const next = !interaction.current.paused;
          interaction.current.paused = next;
          setSpinPaused(next);
        }}
        className="absolute bottom-3 left-3 z-10 rounded bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80"
      >
        {spinPaused ? t('locker.pose.resumeSpin') : t('locker.pose.pauseSpin')}
      </button>
      {import.meta.env.DEV && (
        <DevViewerControls
          devFlags={devFlags}
          setDevFlag={setDevFlag}
          bloomParams={bloomParams}
          setBloomParams={setBloomParams}
        />
      )}
      {import.meta.env.DEV && devFlags.matDebug && <MaterialDebugPanel scene={scene} />}
    </div>
  );
}

function DevViewerControls({
  devFlags,
  setDevFlag,
  bloomParams,
  setBloomParams,
}: {
  devFlags: DevPreviewFlags;
  setDevFlag: (key: keyof DevPreviewFlags, storageKey: string, value: boolean) => void;
  bloomParams: BloomParams;
  setBloomParams: Dispatch<SetStateAction<BloomParams>>;
}) {
  useControls(
    'Preview',
    () => ({
      S2: {
        value: devFlags.source2,
        onChange: (value: boolean) =>
          setDevFlag('source2', 'grimoire.preview.source2Shaders', value),
      },
      NPR: {
        value: devFlags.npr,
        onChange: (value: boolean) => setDevFlag('npr', 'grimoire.preview.npr', value),
      },
      Outline: {
        value: devFlags.nprOutline,
        onChange: (value: boolean) =>
          setDevFlag('nprOutline', 'grimoire.preview.nprOutline', value),
      },
      Unified: {
        value: devFlags.unified,
        onChange: (value: boolean) =>
          setDevFlag('unified', 'grimoire.preview.unifiedMaterial', value),
      },
      'Cel v2': {
        value: devFlags.celV2,
        onChange: (value: boolean) => setDevFlag('celV2', 'grimoire.preview.celV2', value),
      },
      FX: {
        value: devFlags.effects,
        onChange: (value: boolean) => setDevFlag('effects', 'grimoire.preview.effects', value),
      },
      Bloom: folder(
        {
          On: {
            value: devFlags.bloom,
            onChange: (value: boolean) => setDevFlag('bloom', 'grimoire.preview.bloom', value),
          },
          Int: {
            value: bloomParams.intensity,
            min: 0,
            max: 5,
            step: 0.05,
            onChange: (value: number) =>
              setBloomParams((current) => ({ ...current, intensity: value })),
          },
          Radius: {
            value: bloomParams.radius,
            min: 0,
            max: 2,
            step: 0.01,
            onChange: (value: number) =>
              setBloomParams((current) => ({ ...current, radius: value })),
          },
          Gate: {
            value: bloomParams.threshold,
            min: 0,
            max: 2,
            step: 0.01,
            onChange: (value: number) =>
              setBloomParams((current) => ({ ...current, threshold: value })),
          },
        },
        { collapsed: true }
      ),
      Debug: folder(
        {
          Log: {
            value: devFlags.nprDebug,
            onChange: (value: boolean) =>
              setDevFlag('nprDebug', 'grimoire.preview.nprDebug', value),
          },
          Mats: {
            value: devFlags.matDebug,
            onChange: (value: boolean) =>
              setDevFlag('matDebug', 'grimoire.preview.matDebug', value),
          },
          Cloth: {
            value: devFlags.cloth,
            onChange: (value: boolean) => setDevFlag('cloth', 'grimoire.preview.cloth', value),
          },
        },
        { collapsed: true }
      ),
    }),
    [bloomParams, devFlags, setBloomParams, setDevFlag]
  );

  return (
    <Leva
      collapsed={false}
      hideCopyButton
      oneLineLabels
      theme={COMPACT_LEVA_THEME}
      titleBar={{ title: 'Preview', drag: true, filter: false }}
    />
  );
}

function MaterialDebugPanel({ scene }: { scene: THREE.Object3D | null }) {
  const rows = useMemo(() => {
    if (!scene) return [];
    const byName = new Map<string, { name: string; morphic: MorphicExtras }>();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const morphic = getMorphic(m);
        if (!morphic) continue;
        const name = m.name || morphic.shader || '(unnamed)';
        if (!byName.has(name)) byName.set(name, { name, morphic });
      }
    });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scene]);

  if (rows.length === 0) return null;

  const fmtExpr = (e: MorphicDynamicExpr) =>
    e.decompiled ? e.source : `[decompile failed: ${e.error ?? 'unknown'} #${e.hash.slice(0, 8)}]`;

  return (
    <div className="absolute bottom-3 right-3 z-10 max-h-[60%] w-[28rem] max-w-[55vw] overflow-auto rounded bg-black/80 p-2 font-mono text-[10px] leading-tight text-white">
      <div className="mb-1 font-semibold">morphic extras - {rows.length} material(s)</div>
      {rows.map(({ name, morphic }) => {
        const dyn = Object.entries(morphic.dynamic_params ?? {});
        const dynTex = Object.entries(morphic.dynamic_texture_params ?? {});
        const slots = Object.keys(morphic.texture_slots ?? {});
        const resolved = Object.keys(morphic.resolvedTextures ?? {});
        return (
          <div key={name} className="mb-1.5 border-t border-white/20 pt-1">
            <div className="text-amber-300">{name}</div>
            <div>
              schema v{morphic.schema_version ?? 1} - {morphic.shader} -{' '}
              {morphic.blend_mode ?? 'opaque'}
              {flag(morphic, 'F_USE_NPR_LIGHTING') ? ' - NPR' : ''}
            </div>
            <div>
              slots: {slots.length} ({resolved.length} resolved)
              {slots.length ? `: ${slots.join(', ')}` : ''}
            </div>
            {dyn.length > 0 && (
              <div className="text-cyan-300">
                dynamic_params ({dyn.length}):
                {dyn.map(([k, e]) => (
                  <div key={k} className="pl-2">
                    {k} = {fmtExpr(e)}
                  </div>
                ))}
              </div>
            )}
            {dynTex.length > 0 && (
              <div className="text-cyan-300">
                dynamic_texture_params ({dynTex.length}):
                {dynTex.map(([k, e]) => (
                  <div key={k} className="pl-2">
                    {k} = {fmtExpr(e)}
                  </div>
                ))}
              </div>
            )}
            {(morphic.render_attributes_used?.length ?? 0) > 0 && (
              <div className="text-white/60">attrs: {morphic.render_attributes_used!.join(', ')}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
