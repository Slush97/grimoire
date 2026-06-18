/**
 * Live r3f preview for the dev pose-authoring tool (slice 4).
 *
 * One WebGL context (a single r3f Canvas). Mirrors HeroPoseViewer's Canvas setup
 * (fov 40, alpha + ACESFilmicToneMapping + exposure 0.8, the IBL probe) but the
 * camera is DRIVEN BY the authored framing (applyFraming from the shared
 * heroPoseScene module) rather than free OrbitControls, so the preview frames the
 * hero IDENTICALLY to the bake. Optional Inspect mode swaps in OrbitControls and,
 * on release, reports the resolved yaw/pitch/distance/target back to the parent so
 * leaving Inspect keeps the hand-framed view.
 *
 * The GLB is the static posed still produced on demand by
 * `vpkmerge model export --pose` (exportHeroPose), served via the privileged
 * `grimoire-hero:` scheme; it carries no skeleton/clips, so it renders as plain
 * meshes. Everything created here (model scene + IBL render target + renderer) is
 * disposed on unmount per the heroPoseScene INVARIANTS.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Loader2 } from 'lucide-react';
import {
  applyFraming,
  disposeScene,
  enableVertexColors,
  framingCameraPosition,
  loadIblEnvironment,
  normalizeModel,
} from '../../lib/heroPoseScene';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import { exportHeroPose, getHeroPanoramaBackdrop, getHeroPoseInfo } from '../../lib/api';
import type {
  HeroBackdrop,
  HeroCameraFraming,
  HeroPoseSelection,
  HeroPoseSkinSource,
} from '../../types/portrait';

const HERO_POSE_SCHEME = 'grimoire-hero';

function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key contains `::` and a `/` for overflow skins, which a scheme forbids
  // in the host, so carry it as a single encoded path segment under `m`.
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
}

const DEG2RAD = Math.PI / 180;

/** Image-based lighting from the baked Deadlock probe, loaded once via the
 *  SHARED loadIblEnvironment so the preview lights identically to the bake. */
function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let disposed = false;
    let handle: (() => void) | null = null;
    void loadIblEnvironment(gl)
      .then(({ texture, dispose }) => {
        if (disposed) {
          dispose();
          return;
        }
        scene.environment = texture;
        handle = dispose;
      })
      .catch(() => {
        // Missing IBL just falls back to the directionals; not fatal.
      });
    return () => {
      disposed = true;
      scene.environment = null;
      handle?.();
    };
  }, [gl, scene]);
  return null;
}

/** The posed figure: normalized to a consistent height + centered (shared
 *  normalizeModel), under a yaw wrapper for the authored model spin. No
 *  turntable here: a still, framing-driven preview is what bakes. */
function PosedModel({
  scene,
  modelYawDeg,
}: {
  scene: THREE.Object3D;
  modelYawDeg: number;
}) {
  const norm = useMemo(() => normalizeModel(scene), [scene]);
  useEffect(() => {
    enableVertexColors(scene);
  }, [scene]);
  return (
    <group rotation={[0, modelYawDeg * DEG2RAD, 0]}>
      <group scale={norm.scale}>
        <group position={[-norm.center.x, -norm.center.y, -norm.center.z]}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  );
}

/** Drives the camera from the authored framing every frame (the default), so
 *  the preview is exactly what bakes. When `inspect` is on, hands control to
 *  OrbitControls and, on release, reports the resolved framing back. */
function CameraRig({
  framing,
  inspect,
  onInspectCommit,
}: {
  framing: HeroCameraFraming;
  inspect: boolean;
  onInspectCommit: (framing: HeroCameraFraming) => void;
}) {
  const { camera, gl, size } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const framingRef = useRef(framing);
  const onCommitRef = useRef(onInspectCommit);
  // Keep the frame-loop refs current without touching refs during render.
  useEffect(() => {
    framingRef.current = framing;
  }, [framing]);
  useEffect(() => {
    onCommitRef.current = onInspectCommit;
  }, [onInspectCommit]);

  // Inspect mode: build OrbitControls, seed them from the current framing, and
  // on release derive yaw/pitch/distance/target back out and report it up.
  useEffect(() => {
    if (!inspect) return;
    const cam = camera as THREE.PerspectiveCamera;
    const f = framingRef.current;
    const controls = new OrbitControls(cam, gl.domElement);
    controls.enableDamping = true;
    controls.target.set(f.target[0], f.target[1], f.target[2]);
    cam.position.copy(framingCameraPosition(f));
    controls.update();
    controlsRef.current = controls;

    const onEnd = () => {
      const target = controls.target;
      const offset = new THREE.Vector3().subVectors(cam.position, target);
      const distance = offset.length();
      const pitchDeg = Math.asin(THREE.MathUtils.clamp(offset.y / (distance || 1), -1, 1)) / DEG2RAD;
      const yawDeg = Math.atan2(offset.x, offset.z) / DEG2RAD;
      onCommitRef.current({
        yawDeg,
        pitchDeg,
        distance,
        target: [target.x, target.y, target.z],
      });
    };
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('end', onEnd);
      controlsRef.current = null;
      controls.dispose();
    };
  }, [inspect, camera, gl]);

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (inspect) {
      controlsRef.current?.update();
      return;
    }
    // Framing-driven: re-apply every frame so slider edits track live.
    applyFraming(cam, framingRef.current, size.width / size.height);
  });
  return null;
}

export default function PoseAuthorPreview({
  heroName,
  skinSources,
  fallbackSkinMetaKey,
  pose,
  framing,
  modelYawDeg,
  inspect,
  onInspectCommit,
}: {
  heroName: string;
  skinSources: HeroPoseSkinSource[];
  fallbackSkinMetaKey?: string;
  pose?: HeroPoseSelection;
  framing: HeroCameraFraming;
  modelYawDeg: number;
  inspect: boolean;
  onInspectCommit: (framing: HeroCameraFraming) => void;
}) {
  const { t } = useTranslation();
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [backdrop, setBackdrop] = useState<HeroBackdrop | null>(null);
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);

  const sourceKey = skinSources.map((s) => `${s.priority}:${s.metaKey}`).join('|') || 'vanilla';
  const poseKey = pose ? `${pose.clip ?? ''}@${pose.frame ?? 0}` : 'default';

  // Backdrop: the active skin stack's card art, or vanilla. Independent of the
  // pose, so keyed only on hero + skin stack.
  useEffect(() => {
    let cancelled = false;
    setBackdrop(null);
    void getHeroPanoramaBackdrop(heroName, skinSources)
      .then((b) => {
        if (!cancelled) setBackdrop(b);
      })
      .catch(() => {
        if (!cancelled) setBackdrop(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroName, sourceKey]);

  // Pose GLB: re-export when the pose selection changes (the pose is part of the
  // export cache key, so a new clip/frame produces a new still).
  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Object3D | null = null;
    setScene(null);
    setFailed(false);

    (async () => {
      try {
        let info = await getHeroPoseInfo(heroName, skinSources, pose);
        if (cancelled) return;
        if (!info.hasModel) {
          setGenerating(true);
          info = await exportHeroPose(heroName, skinSources, fallbackSkinMetaKey, pose);
          if (cancelled) return;
          setGenerating(false);
        }
        if (!info.hasModel) {
          if (!cancelled) setFailed(true);
          return;
        }
        const gltf = await loadGltfPreview(meshUrlFor(info.key, info.mtimeMs));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroName, sourceKey, poseKey, fallbackSkinMetaKey]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="max-w-xs text-center text-sm text-text-secondary">
          {t('locker.poseAuthor.cannotPose')}
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {/* The card backdrop sits behind the canvas (the canvas has alpha:true so
          the model composites over it). A plain cover-fit <img> avoids the
          background-texture stretch noted in heroPoseScene. */}
      {backdrop && (
        <img
          src={backdrop.dataUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {!scene && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-white/80" />
          {generating && (
            <p className="text-xs text-text-secondary">{t('locker.poseAuthor.posing', { hero: heroName })}</p>
          )}
        </div>
      )}
      {scene && (
        <Canvas
          className="absolute inset-0"
          camera={{ position: [0, 0, 3.2], fov: 40 }}
          dpr={[1, 2]}
          gl={{
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 0.8,
          }}
        >
          <Environment />
          <ambientLight intensity={0.12} />
          <directionalLight position={[3, 5, 4]} intensity={1.1} color="#fff3e0" />
          <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#cfe0ff" />
          <PosedModel scene={scene} modelYawDeg={modelYawDeg} />
          <CameraRig framing={framing} inspect={inspect} onInspectCommit={onInspectCommit} />
        </Canvas>
      )}
    </div>
  );
}
