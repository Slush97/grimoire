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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FULL_EFFECTS_PREVIEW_DEFAULTS, heroPresentationStorageKey, initialHeroPreviewFlags } from './heroViewerDefaults';
import { heroPreviewBounds } from '../../lib/heroPreviewBounds';
import { Loader2 } from 'lucide-react';
import { getAssetPath } from '../../lib/assetPath';
import {
  getHeroPoseInfo,
  exportHeroPose,
  getRiggedHeroPose,
  exportRiggedHeroPose,
  getHeroEffectInfo,
  exportHeroEffect,
  previewTrippySprite,
} from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import { prepareSource2VertexColors } from '../../lib/source2VertexColors';
import { loadRiggedHeroPreview } from '../../lib/loadRiggedHeroPreview';
import { ParticleEffect } from './ParticleEffect';
import { fxPreviewIssues, type FxDescriptor } from './fxDescriptor';
import { particleAttachmentIssues } from './particleAttachment';
import { useClothSim } from '../../lib/useClothSim';
import type { ClothModel } from '../../lib/feModel';
import { BloomEffect } from './BloomEffect';
import { HeroViewerToolbar, type HeroViewerScene } from './HeroViewerToolbar';
import { heroAnimationRecipe, preferredHeroAnimationName } from '../../lib/heroAnimationCatalog';
import { ViewerBackdrop, ViewerBackdropControls } from './ViewerBackdrop';
import { useViewerBackdrop } from '../../lib/useViewerBackdrop';
import { useViewerGif } from '../../lib/useViewerGif';
import { clampAnimationTime, clampPlaybackSpeed, type HeroPlaybackProgress, type HeroPlaybackSeek } from '../../lib/heroViewerPlayback';
import {
  isNprMaterial,
  isSelfIllumMaterial,
  wrapMaterialWithNpr,
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
import { compileSource2DrawState, summarizeSource2Scene } from '../../lib/source2Preview';
import { resolveHeroPoseRenderFeatures } from './heroPoseRenderFeatures';
import type { HeroPoseSkinSource } from '../../types/portrait';
import type { TrippySpriteResult } from '../../types/mod';
import type { TrippyPreview } from '../../stores/trippyPreviewStore';

/**
 * Live 3D preview of a hero's menu pose for the Locker's per-hero view.
 *
 * Starts with animation and supported effects enabled. Physics loads an animated rig and
 * its matching cloth sidecar. Both are exported on demand by vpkmerge and
 * served from the user's cache through the `grimoire-hero:` scheme.
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

// UnrealBloomPass starting params. Threshold is in LINEAR space, so it mainly catches
// the capped self-illum (peak ~ selfIllumCap) and the brightest speculars, not the
// whole hero. All three are calibration knobs - tune against a glowing hero.
const BLOOM_INTENSITY = 1;
const BLOOM_RADIUS = 0.5;
// Authored sprite cards can saturate before blending. A threshold above one
// excludes those effects and subdued emissive eyes from selective bloom.
const BLOOM_THRESHOLD = 0.85;

// Full preview effects start enabled; explicit saved switches take precedence.
const RELEASE_RENDER_FLAGS = FULL_EFFECTS_PREVIEW_DEFAULTS;

type DevPreviewFlags = typeof RELEASE_RENDER_FLAGS & {
  effects: boolean;
  animated: boolean;
};

type BloomParams = {
  intensity: number;
  radius: number;
  threshold: number;
};

const COMPACT_LEVA_THEME = {
  sizes: {
    rootWidth: '300px',
    controlWidth: '150px',
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


function writePreviewFlag(name: string, value: boolean): void {
  if (typeof window !== 'undefined') {
    const key = name.replace('grimoire.preview.', '');
    const presentation = ['animated', 'cloth', 'effects', 'bloom', 'autoRotate'].includes(key);
    window.localStorage.setItem(presentation ? heroPresentationStorageKey(key) : name, value ? '1' : '0');
  }
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
const PREVIEW_CAMERA = { position: [0, 0, 3.2] as [number, number, number], fov: 40 };

function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key contains `::` (and a `/` for overflow skins), which a standard
  // scheme forbids in the host, so carry it as a single encoded path segment
  // under a fixed `m` host.
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
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
  prepareSource2VertexColors(scene);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.color) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && !getMorphic(sm) && !sm.vertexColors) {
        sm.vertexColors = true;
        sm.needsUpdate = true;
      }
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** Prefer an idle loop from the exported animation menu. */
function pickIdleClip(clips: THREE.AnimationClip[], heroName?: string): THREE.AnimationClip | null {
  const valid = clips.filter((c) => Number.isFinite(c.duration) && c.duration > 0.001);
  const name = preferredHeroAnimationName(valid.map((c) => c.name), heroName);
  return valid.find((c) => c.name === name) ?? null;
}

/** Shared pointer-interaction state between OrbitControls and the model group:
 *  the turntable pauses while `dragging`. A mutable ref so it updates without
 *  re-rendering. */
export type TurntableInteraction = { dragging: boolean; paused: boolean };
const normalizedScenes = new WeakMap<THREE.Object3D, { scale: number; center: THREE.Vector3; bounds: THREE.Box3 }>();

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
  interaction: RefObject<TurntableInteraction>,
  reset = 0,
): void {
  useEffect(() => { groupRef.current?.rotation.set(0, 0, 0); }, [groupRef, reset]);
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
  reset = 0,
}: {
  scene: THREE.Object3D;
  interaction: RefObject<TurntableInteraction>;
  effect?: EffectMount | null;
  reset?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Normalize by the largest dimension so every hero fills the frame the same
  // regardless of native model scale, and recenter on the origin.
  const norm = useMemo(() => {
    const cached = normalizedScenes.get(scene);
    if (cached) return cached;
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 2.0 / maxDim : 1;
    const result = { scale, center, bounds: box.clone().applyMatrix4(scene.matrixWorld.clone().invert()) };
    normalizedScenes.set(scene, result);
    return result;
  }, [scene]);

  // Per-vertex COLOR multiply where present (skin tone / accents render flat
  // white without it); see enableVertexColors.
  useEffect(() => {
    enableVertexColors(scene);
  }, [scene]);

  useTurntable(groupRef, interaction, reset);

  return (
    <group ref={groupRef} scale={norm.scale}>
      <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
        <primitive object={scene} />
        {effect && (
          <ParticleEffect descriptor={effect.descriptor} textureBaseUrl={effect.baseUrl} model={scene} />
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
export function RiggedModel({
  heroName,
  scene,
  clips,
  interaction,
  clothModel,
  clothEnabled,
  effect,
  clipName,
  playback,
  seek,
  progressRef,
  reset,
}: {
  heroName?: string;
  clipName: string;
  playback: { paused: boolean; speed: number };
  seek?: HeroPlaybackSeek;
  progressRef?: RefObject<HeroPlaybackProgress>;
  reset: number;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  interaction: RefObject<TurntableInteraction>;
  clothModel: ClothModel | null;
  clothEnabled: boolean;
  effect?: EffectMount | null;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const selectedClip = useMemo(() => clips.find((c) => c.name === clipName) ?? pickIdleClip(clips, heroName), [clips, clipName, heroName]);

  // Normalize from the BIND/rest pose, once. Force the skeleton to bind pose and
  // flush world matrices first so the AABB is the true rest extent and does not
  // change frame to frame.
  const norm = useMemo(() => {
    const cached = normalizedScenes.get(scene);
    if (cached) return cached;
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
    const result = { scale, center, bounds: box.clone().applyMatrix4(scene.matrixWorld.clone().invert()) };
    normalizedScenes.set(scene, result);
    return result;
  }, [scene]);

  useEffect(() => {
    enableVertexColors(scene);
  }, [scene]);

  // Cleanup runs before setup on a motion change. Reset after the old cloth
  // and mixer release their channels, then calibrate physics from bind pose.
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.pose();
    });
    scene.updateWorldMatrix(true, true);
  }, [scene, clipName, seek]);

  const clothResetKey = JSON.stringify([clipName, seek?.revision ?? 0]);
  const clothStep = useClothSim(scene, clothEnabled ? clothModel : null, clothResetKey);

  // Register after cloth captures bind transforms. Applying time zero makes a
  // selected motion visible immediately, including while playback is paused.
  useEffect(() => {
    const clip = selectedClip;
    if (!clip) {
      if (progressRef) progressRef.current = { time: 0, duration: 0 };
      return;
    }
    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;
    const action = mixer.clipAction(clip);
    const hold = heroAnimationRecipe(clip.name, heroName)?.playback === 'hold';
    action.setLoop(hold ? THREE.LoopOnce : THREE.LoopRepeat, hold ? 1 : Infinity);
    action.clampWhenFinished = hold;
    action.reset().play();
    const time = clampAnimationTime(seek?.time ?? 0, clip.duration);
    // Repeat actions wrap at duration. Sample just inside the end so dragging
    // the timeline to its last position shows the final pose, not time zero.
    mixer.setTime(hold ? time : Math.min(time, Math.max(0, clip.duration - 1e-7)));
    if (progressRef) progressRef.current = { time, duration: clip.duration };
    return () => {
      action.stop();
      mixer.stopAllAction();
      mixer.uncacheClip(clip);
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
    };
  }, [scene, selectedClip, seek, progressRef, heroName]);

  // The cloth driver restores the clean pose before advancing animation. With
  // physics disabled it advances the mixer directly at the render frame rate.
  useFrame((_, delta) => {
    if (!playback.paused) clothStep(delta * clampPlaybackSpeed(playback.speed), (dt) => { mixerRef.current?.update(dt); });
    const mixer = mixerRef.current;
    const clip = selectedClip;
    if (progressRef && mixer && clip && !playback.paused) {
      progressRef.current.time = clampAnimationTime(mixer.existingAction(clip)?.time ?? 0, clip.duration);
      progressRef.current.duration = clip.duration;
    }
  });

  useTurntable(groupRef, interaction, reset);

  return (
    <group ref={groupRef} scale={norm.scale}>
      <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
        <primitive object={scene} />
        {effect && (
          <ParticleEffect key={`${clipName}:${seek?.revision ?? 0}`} descriptor={effect.descriptor} textureBaseUrl={effect.baseUrl} model={scene} playback={playback} />
        )}
      </group>
    </group>
  );
}

/** Mouse orbit + zoom, damped. Auto-rotation lives on the model group so the
 *  controls don't fight it; dragging just reorients the camera. */
export function Controls({ interaction, reset, label, model, fitKey }: { interaction: RefObject<TurntableInteraction>; reset: number; label: string; model: THREE.Object3D; fitKey: string }) {
  const { camera, gl, size: viewportSize } = useThree();
  const controlsRef = useRef<ComponentRef<typeof DreiOrbitControls> | null>(null);
  const pendingFit = useRef(true);
  useEffect(() => {
    pendingFit.current = true;
  }, [camera, model, fitKey, reset, viewportSize.width, viewportSize.height]);
  // Fit after the mounted figure has updated its pose and wrapper transforms.
  // OrbitControls can mount after this component's effects, so retry until its
  // ref is ready and keep the fitted target under imperative control.
  useFrame(() => {
    const controls = controlsRef.current;
    if (!pendingFit.current || !controls || viewportSize.width <= 0 || viewportSize.height <= 0) return;
    model.updateWorldMatrix(true, false);
    // SkinnedMesh refreshes its attached bind inverse in updateMatrixWorld,
    // not updateWorldMatrix. Without this pass the first bounds include the
    // normalization wrapper twice; later rendered frames hide the mistake.
    model.updateMatrixWorld(true);
    const bounds = heroPreviewBounds(model, normalizedScenes.get(model)?.bounds);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const perspective = camera as THREE.PerspectiveCamera;
    const tangent = Math.tan(THREE.MathUtils.degToRad(perspective.fov ?? 40) / 2);
    const distance = Math.max(1.6, Math.max(size.y / 2 / tangent,
      size.x / 2 / tangent / Math.max(0.001, perspective.aspect ?? 1)) * 1.2 + size.z / 2);
    camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
    controls.target.copy(center);
    controls.maxDistance = Math.max(6, distance * 2);
    Object.assign(camera.userData, { previewHome: { position: camera.position.toArray(), target: center.toArray() } });
    controls.update();
    pendingFit.current = false;
  });
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', label);
    const focus = () => canvas.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      const controls = controlsRef.current;
      if (!controls || event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'q', 'e', 'r', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      if (key === 'r') {
        const home = camera.userData.previewHome as { position: number[]; target: number[] } | undefined;
        controls.target.fromArray(home?.target ?? [0, 0, 0]);
        camera.position.fromArray(home?.position ?? [0, 0, 3.2]);
      } else if (key === 'q' || key === 'e') {
        camera.position.copy(controls.target).add(offset.setLength(THREE.MathUtils.clamp(offset.length() * (key === 'q' ? 1 / 1.1 : 1.1), controls.minDistance, controls.maxDistance)));
      } else {
        const horizontal = ['a', 'd', 'arrowleft', 'arrowright'].includes(key);
        const sign = ['a', 'w', 'arrowleft', 'arrowup'].includes(key) ? 1 : -1;
        if (event.shiftKey) {
          const direction = new THREE.Vector3(horizontal ? sign * 0.06 : 0, horizontal ? 0 : sign * 0.06, 0).applyQuaternion(camera.quaternion);
          controls.target.add(direction);
          camera.position.add(direction);
        } else {
          const spherical = new THREE.Spherical().setFromVector3(offset);
          if (horizontal) spherical.theta += sign * 0.08;
          else spherical.phi -= sign * 0.08;
          spherical.makeSafe();
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        }
      }
      controls.update();
    };
    canvas.addEventListener('pointerdown', focus);
    canvas.addEventListener('keydown', keydown);
    return () => { canvas.removeEventListener('pointerdown', focus); canvas.removeEventListener('keydown', keydown); };
  }, [camera, gl, label]);
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

/** Image-based lighting from a studio room or the legacy baked dusk probe.
 *  Runs the selected source through PMREM and assigns the result as
 *  `scene.environment` so every MeshStandardMaterial gets real reflections and
 *  ambient instead of dead-flat directional-only shading. The PMREM target is
 *  bound to this Canvas's GL context, so it is generated per-mount (the per-hero
 *  view shows a single viewer); SoulContainerViewer would want a shared probe.
 *  Drei Environment is not used here: the viewer needs HDRCubeTextureLoader's
 *  six-face Radiance cubemap path and HalfFloat PMREM for the Deadlock IBL. */
function Environment({ intensity, studio }: { intensity: number; studio: boolean }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- R3F owns this mutable Three.js scene.
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  useEffect(() => {
    let disposed = false;
    const pmrem = new THREE.PMREMGenerator(gl);
    let envRT: THREE.WebGLRenderTarget | null = null;
    if (studio) {
      // Dark studio walls leave room for bright softbox highlights on glass and
      // metal instead of covering the surface with a broad gray reflection.
      const room = new RoomEnvironment();
      room.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof THREE.MeshStandardMaterial) material.color.setRGB(0.05, 0.05, 0.05);
        }
      });
      envRT = pmrem.fromScene(room, 0.04);
      // eslint-disable-next-line react-hooks/immutability -- R3F owns this mutable Three.js scene.
      scene.environment = envRT.texture;
      room.dispose();
      pmrem.dispose();
      return () => {
        scene.environment = null;
        envRT?.dispose();
      };
    }
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
  }, [gl, scene, studio]);
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
  tint,
  unified,
  source2Active,
  celV2,
}: {
  scene: THREE.Object3D;
  enabled: boolean;
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
        selfIllumPulseFn?: ((t: number) => number) | null;
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
        selfIllumPulseFn?: ((t: number) => number) | null;
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
              selfIllumPulseFn: built.selfIllumPulseFn,
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
  }, [scene, enabled, unified, source2Active]);

  // Drive uTime for the self-illum UV scroll (viscous_head's liquid glow).
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    buildsRef.current.forEach((b) => {
      if (b.uniforms.uTime) b.uniforms.uTime.value = t;
      // Drive a dynamic self-illum envelope (inferno body's 0.5*sin(3*time())+0.5).
      // Static scales have no fn and keep uSelfIllumPulse at 1.
      if (b.selfIllumPulseFn && b.uniforms.uSelfIllumPulse) {
        const s = b.selfIllumPulseFn(t);
        // Guard: a future divergent expr could go NaN/Inf mid-stream; one bad
        // uniform write blows out the whole material.
        if (Number.isFinite(s)) b.uniforms.uSelfIllumPulse.value = s;
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

/**
 * Always-on Source 2 draw state. Applies additive / translucent blend, backface
 * culling, and overlay render-order to EVERY material carrying morphic extras,
 * independent of the NPR / unified / source2 / bloom dev flags. This is the one
 * pass that runs on the default preview path, so additive self-illum glow
 * overlays (kept by the vpkmerge exporter) composite as `AdditiveBlending` rather
 * than rendering an opaque white hull. Mesh-level `renderOrder` is the piece the
 * material builders cannot set and persists across the flag-gated material swaps.
 */
function Source2DrawState({ scene, debug }: { scene: THREE.Object3D; debug: boolean }) {
  useEffect(() => {
    const compiled = compileSource2DrawState(scene);
    if (debug) {
      // Phase 3 round-trip inspection: blend-mode + renderOrder distribution and
      // the overlay mesh names, so a maintainer can confirm kept glow overlays
      // composite additively. Logging only; the compile itself is always-on.
      console.info('[source2drawstate]', compiled.stats, summarizeSource2Scene(scene));
    }
    return () => compiled.restore();
  }, [scene, debug]);

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
  const interaction = useRef<TurntableInteraction>({ dragging: false, paused: !initialHeroPreviewFlags().autoRotate });
  const [spinPaused, setSpinPaused] = useState(() => !initialHeroPreviewFlags().autoRotate);
  const [playback, setPlayback] = useState({ paused: false, speed: 1 });
  const [clipName, setClipName] = useState('');
  const [seek, setSeek] = useState<HeroPlaybackSeek>({ time: 0, revision: 0 });
  const playbackProgressRef = useRef<HeroPlaybackProgress>({ time: 0, duration: 0 });
  const [viewerScene, setViewerScene] = useState<HeroViewerScene>('midtown');
  const [resetView, setResetView] = useState(0);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const backdrop = useViewerBackdrop();
  const backdropError = backdrop.errorKey === 'locker.pose.backgroundTooLarge'
    ? t('locker.pose.backgroundTooLarge') : backdrop.errorKey ? t('locker.pose.backgroundFailed') : null;
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [effect, setEffect] = useState<EffectMount | null>(null);
  const [effectUnavailable, setEffectUnavailable] = useState(false);
  const partialEffect = useMemo(() => effect ? fxPreviewIssues(effect.descriptor).length > 0
    || (scene ? particleAttachmentIssues(effect.descriptor, scene).length > 0 : false) : false, [effect, scene]);
  const sourceKey = skinSources.map((source) => `${source.priority}:${source.metaKey}`).join('|');
  const gifError = useCallback(() => setViewerError(t('locker.pose.gifFailed')), [t]);
  const gif = useViewerGif(canvasRef, `${heroName}:${sourceKey}:${scene?.uuid ?? ''}`, heroName, gifError);
  const [devFlags, setDevFlags] = useState<DevPreviewFlags>(initialHeroPreviewFlags);
  const [bloomParams, setBloomParams] = useState<BloomParams>(() => ({
    intensity: BLOOM_INTENSITY,
    radius: BLOOM_RADIUS,
    threshold: BLOOM_THRESHOLD,
  }));
  const setDevFlag = useCallback((key: keyof DevPreviewFlags, storageKey: string, value: boolean) => {
    writePreviewFlag(storageKey, value);
    if ((key === 'effects' || key === 'cloth') && value) writePreviewFlag('grimoire.preview.animated', true);
    setDevFlags((current) => ({ ...current, [key]: value, ...((key === 'effects' || key === 'cloth') && value ? { animated: true } : {}) }));
  }, []);
  const activeRenderFlags = {
    ...(import.meta.env.DEV ? devFlags : RELEASE_RENDER_FLAGS),
    cloth: devFlags.cloth,
    animated: devFlags.animated,
    bloom: devFlags.bloom,
  };
  const effectPreviewEnabled = devFlags.effects;

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
    setSeek((s) => ({ time: 0, revision: s.revision + 1 }));
    playbackProgressRef.current = { time: 0, duration: 0 };
    setRigged(false);
    setClothModel(null);

    (async () => {
      try {
        // Physics opts into the animated rig. Missing clips or failed exports
        // fall back to the standard static menu pose.
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
              const { gltf, clothModel } = await loadRiggedHeroPreview(rig, features.clothPreviewEnabled);
              if (cancelled) {
                disposeScene(gltf.scene);
                return;
              }
              const clip = pickIdleClip(gltf.animations ?? [], heroName);
              if (!clip) {
                disposeScene(gltf.scene);
                throw new Error('Rigged preview GLB has no animated clip.');
              }
              loaded = gltf.scene;
              setClips((gltf.animations ?? []).filter((c) => Number.isFinite(c.duration) && c.duration > 0.001));
              setClipName((current) => gltf.animations.some((candidate) => candidate.name === current
                && Number.isFinite(candidate.duration) && candidate.duration > 0.001) ? current : clip.name);
              setRigged(true);
              setClothModel(clothModel);
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

  // Ambient FX overlay: curated base graphs use the selected skin's texture stack.
  // getHeroEffectInfo cheaply returns hasEffect=false for everyone else. The
  // bundle is built on demand, then the descriptor JSON is fetched over the
  // grimoire-hero: scheme and handed to the renderer.
  useEffect(() => {
    if (!effectPreviewEnabled) { setEffect(null); return; }
    let cancelled = false;
    setEffect(null);
    setEffectUnavailable(false);
    (async () => {
      try {
        let info = await getHeroEffectInfo(heroName, skinSources);
        if (cancelled) return;
        if (!info.entry) { setEffectUnavailable(true); return; }
        if (!info.hasEffect) {
          info = await exportHeroEffect(heroName, skinSources);
          if (cancelled) return;
          if (!info.hasEffect) { setEffectUnavailable(true); return; }
        }
        const res = await fetch(effectDescriptorUrl(info.key));
        if (!res.ok) { if (!cancelled) setEffectUnavailable(true); return; }
        const descriptor = (await res.json()) as FxDescriptor;
        if (cancelled) return;
        setEffect({ descriptor, baseUrl: effectTextureBaseUrl(info.key) });
      } catch {
        if (!cancelled) setEffectUnavailable(true);
        // Effects are a non-essential overlay; a failure leaves the plain pose.
      }
    })();
    return () => {
      cancelled = true;
    };
    // sourceKey covers the stack; parent renders may allocate an equivalent array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroName, sourceKey, effectPreviewEnabled]);

  const toolbar = (
    <HeroViewerToolbar
      heroName={heroName}
      animated={features.riggedPreviewEnabled} clips={clips.map((c) => c.name)} clip={clipName}
      paused={playback.paused} speed={playback.speed} spinPaused={spinPaused}
      progressRef={playbackProgressRef} onSeek={(time) => {
        setPlayback((p) => ({ ...p, paused: true }));
        setSeek((s) => ({ time, revision: s.revision + 1 }));
      }}
      cloth={devFlags.cloth} bloom={devFlags.bloom} particles={devFlags.effects} scene={viewerScene}
      backdropControls={<ViewerBackdropControls hasImage={!!backdrop.texture} loading={backdrop.loading}
        preset={backdrop.preset} onPreset={(value) => {
          if (value !== 'none' && viewerScene === 'transparent') setViewerScene('studio');
          backdrop.choosePreset(value);
        }}
        onFile={(file) => {
          if (viewerScene === 'transparent') setViewerScene('studio');
          void backdrop.choose(file);
        }} onClear={backdrop.clear} />}
      status={viewerError ?? backdropError}
      onAnimated={(v) => {
        writePreviewFlag('grimoire.preview.animated', v);
        if (!v) {
          writePreviewFlag('grimoire.preview.cloth', false);
          writePreviewFlag('grimoire.preview.effects', false);
        }
        setDevFlags((f) => ({ ...f, animated: v, cloth: v ? f.cloth : false, effects: v ? f.effects : false }));
      }}
      onClip={(name) => {
        setClipName(name);
        setSeek((s) => ({ time: 0, revision: s.revision + 1 }));
        playbackProgressRef.current = { time: 0, duration: clips.find((c) => c.name === name)?.duration ?? 0 };
      }} onPaused={(paused) => setPlayback((p) => ({ ...p, paused }))}
      onSpeed={(speed) => setPlayback((p) => ({ ...p, speed }))}
      onSpinPaused={(paused) => { writePreviewFlag('grimoire.preview.autoRotate', !paused); interaction.current.paused = paused; setSpinPaused(paused); }}
      onCloth={(v) => setDevFlag('cloth', 'grimoire.preview.cloth', v)}
      onBloom={(v) => setDevFlag('bloom', 'grimoire.preview.bloom', v)}
      onParticles={(v) => setDevFlag('effects', 'grimoire.preview.effects', v)}
      onScene={setViewerScene} onReset={() => setResetView((v) => v + 1)}
      onScreenshot={() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
          const link = document.createElement('a');
          link.download = `${heroName.replace(/[^a-z0-9_-]/gi, '_')}-preview.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
          setViewerError(null);
        } catch { setViewerError(t('locker.pose.screenshotFailed')); }
      }}
      onFullscreen={() => {
        const request = document.fullscreenElement ? document.exitFullscreen() : viewerRef.current?.requestFullscreen();
        request?.catch(() => setViewerError(t('locker.pose.fullscreenFailed')));
      }}
      gifAvailable={!!scene} gif={gif} onGif={() => { setViewerError(null); void gif.toggle(); }}
    />
  );

  return (
    <div ref={viewerRef}
      data-particle-availability={effectUnavailable ? 'unavailable' : partialEffect ? 'partial' : effect ? 'ready' : 'pending'}
      data-animation-availability={scene ? rigged ? 'ready' : 'unavailable' : 'pending'}
      data-cloth-availability={scene ? clothModel ? 'ready' : 'unavailable' : 'pending'}
      className={`absolute inset-0 ${viewerScene === 'transparent' ? '' : 'bg-bg-secondary'}`}>
      {failed ? <HeroPoseFailureState message={t('locker.pose.cannotPose')} /> : !scene ? (
        <HeroPoseLoadingState generating={generating} heroName={heroName} skinSourceCount={skinSources.length} t={t} />
      ) : <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
        camera={PREVIEW_CAMERA}
        dpr={[1, 2]}
        gl={{
          alpha: true,
          toneMapping: THREE.NoToneMapping,
          preserveDrawingBuffer: true,
        }}
      >
        <ViewerBackdrop texture={viewerScene === 'transparent' ? null : backdrop.texture} />
        {/* The IBL probe supplies ambient + reflections, so the bare ambientLight
            is gone and the directionals are softened to a warm key + cool fill
            that just shapes the form on top of the environment. */}
        <Environment intensity={viewerScene === 'midtown' ? 1.6 : 1.1} studio />
        <hemisphereLight args={[new THREE.Color(96 / 255, 135 / 255, 183 / 255), new THREE.Color(0.32, 0.25, 0.2), 1.5]} />
        <directionalLight castShadow position={[-3, 4, 3]} intensity={viewerScene === 'midtown' ? 2.2 : 1.4}
          color={viewerScene === 'midtown' ? new THREE.Color(254 / 255, 153 / 255, 91 / 255) : new THREE.Color(1, 1, 1)}
          shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
        <directionalLight position={[3, 2, -3]} intensity={1.2} color={new THREE.Color(0.65, 0.78, 1)} />
        {viewerScene !== 'transparent' && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.02, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <shadowMaterial transparent opacity={0.25} />
          </mesh>
        )}
        {rigged ? (
          <RiggedModel
            heroName={heroName}
            reset={resetView}
            clipName={clipName}
            playback={playback}
            seek={seek}
            progressRef={playbackProgressRef}
            scene={scene}
            clips={clips}
            interaction={interaction}
            clothModel={clothModel}
            clothEnabled={features.clothPreviewEnabled}
            effect={effectPreviewEnabled ? effect : null}
          />
        ) : (
          <PosedModel reset={resetView} scene={scene} interaction={interaction} />
        )}
        {scene && <Source2DrawState scene={scene} debug={features.nprDebugEnabled} />}
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
            tint={null /* wire to a recolor color once the Locker recolor surface exists */}
            unified={features.unifiedEnabled}
            source2Active={features.source2ShaderHintsEnabled}
            celV2={features.celV2Enabled}
          />
        )}
        {trippySprite && <TrippyPaint scene={scene} sprite={trippySprite} />}
        {scene && (
          <BloomEffect
            deadlockExposure={viewerScene === 'midtown' ? 1.6 : 1.3}
            intensity={features.bloomEnabled ? bloomParams.intensity : 0}
            radius={import.meta.env.DEV ? bloomParams.radius : BLOOM_RADIUS}
            threshold={import.meta.env.DEV ? bloomParams.threshold : BLOOM_THRESHOLD}
          />
        )}
        <Controls interaction={interaction} reset={resetView} label={t('locker.pose.cameraHint')} model={scene} fitKey={clipName} />
      </Canvas>}
      {toolbar}
      {import.meta.env.DEV && new URLSearchParams(window.location.search).has('viewer-debug') && (
        <DevViewerControls
          devFlags={devFlags}
          setDevFlag={setDevFlag}
          bloomParams={bloomParams}
          setBloomParams={setBloomParams}
        />
      )}
      {scene && import.meta.env.DEV && devFlags.matDebug && <MaterialDebugPanel scene={scene} />}
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
          <div key={name} className="mb-1.5 border-t border-hl/20 pt-1">
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
