import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { makeBackdropTexture } from './soulBackdrops';

/**
 * Live 3D preview for the Soul Container import.
 *
 * Renders the GLB exported by the vpkmerge preview pipeline. A translucent
 * reference shell at the vanilla span sits alongside it for an upright/size
 * read.
 *
 * Its own WebGL context (separate from the Locker grid's shared canvas) with
 * preserveDrawingBuffer so the modal can capture a thumbnail on build.
 */

/** The vanilla soul container's largest-axis span in Source units (the build
 *  always fits the import's largest axis to exactly this). */
export const SOUL_TARGET_SPAN = 12.65;

const SPIN_RATE = 0.35; // rad/sec
const CAMERA_DISTANCE = SOUL_TARGET_SPAN * 3.0;
const CAMERA_HEIGHT = SOUL_TARGET_SPAN * 0.35;
// Saved thumbnails freeze to this 3/4 yaw (instead of a random spin frame) so
// every card reads from a consistent, flattering angle.
const CAPTURE_YAW = -Math.PI * 0.18;
type SoulOrientMode = 'y-up' | 'z-up' | 'flip-y' | 'auto';

// --- Hero-for-scale reference --------------------------------------------
// A standing hero rendered around the orb so the user can judge size + facing
// without going in-game. The orb stays at the origin and the hero is placed so
// the orb floats at their back hip (where a soul container sits in-game): the
// hero faces away from the camera, the orb hovering just off their lower back.
// Heights are in the same preview units as the orb's SOUL_TARGET_SPAN: an
// in-game hero is roughly 5.7x the orb's span tall. Tunable; the in-game read
// is the source of truth.
const HERO_PREVIEW_HEIGHT = SOUL_TARGET_SPAN * 5.7;
const HERO_HIP_FRACTION = 0.52; // hip is ~52% up the body
const HERO_HIP_SIDE = 0.55; // orb sits at one hip, this fraction of the half-width off-center
const ORB_BACK_PROUD = (SOUL_TARGET_SPAN / 2) * 0.4; // how far the orb pokes out past the hero's back
// Slight up + right nudge of the orb relative to the hero (the orb stays at the
// origin for capture, so we shift the hero the opposite way).
const ORB_NUDGE_UP = SOUL_TARGET_SPAN * 0.35;
const ORB_NUDGE_RIGHT = SOUL_TARGET_SPAN * 0.3;

interface HeroFit {
  scale: number;
  /** Pre-scale offset that grounds the feet at y=0 and centers x/z. */
  offset: THREE.Vector3;
  /** Post-scale half-width, for placing the orb at one hip. */
  halfWidth: number;
  /** Post-scale half-depth (front-to-back), so the orb clears the back surface. */
  halfDepth: number;
}

/** Fit a hero pose GLB to HERO_PREVIEW_HEIGHT, feet grounded, centered x/z. */
function buildHeroFit(scene: THREE.Object3D): HeroFit {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) {
    return { scale: 1, offset: new THREE.Vector3(), halfWidth: SOUL_TARGET_SPAN, halfDepth: SOUL_TARGET_SPAN };
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = HERO_PREVIEW_HEIGHT / (size.y || 1);
  return {
    scale,
    offset: new THREE.Vector3(-center.x, -box.min.y, -center.z),
    halfWidth: (size.x * scale) / 2,
    halfDepth: (size.z * scale) / 2,
  };
}

/**
 * Attaches the chosen backdrop as the scene background (declaratively, so r3f
 * restores the previous value on unmount). Disposes the texture on change.
 * A negative index renders nothing (transparent).
 */
function Backdrop({ index }: { index: number }) {
  const texture = useMemo(() => makeBackdropTexture(index), [index]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return <primitive object={texture} attach="background" />;
}

function makeMaterialPreviewSafe(material: THREE.Material): void {
  material.side = THREE.DoubleSide;
  material.visible = true;
  material.needsUpdate = true;

  if ('opacity' in material && typeof material.opacity === 'number' && material.opacity <= 0) {
    material.opacity = 1;
    material.transparent = false;
  }
}

function makeSourceMeshesVisible(scene: THREE.Object3D): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.visible = true;
    mesh.frustumCulled = false;

    const current = mesh.material;
    const materials = Array.isArray(current) ? current : [current];
    for (const material of materials) {
      if (material) makeMaterialPreviewSafe(material);
    }
  });
}

/** Position + aim the camera. Orb-only: tight on the origin. Hero mode: pull
 *  back and up to frame the full standing hero (the orb stays at the origin,
 *  which is the hero's back hip), still looking at the origin. */
function PreviewCamera({ heroMode }: { heroMode: boolean }) {
  const camera = useThree((s) => s.camera);

  useLayoutEffect(() => {
    if (heroMode) {
      camera.position.set(0, HERO_PREVIEW_HEIGHT * 0.18, HERO_PREVIEW_HEIGHT * 1.7);
    } else {
      camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    }
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }, [camera, heroMode]);

  return null;
}

function expandByTransformedBox(target: THREE.Box3, source: THREE.Box3, matrix: THREE.Matrix4): void {
  const points = [
    new THREE.Vector3(source.min.x, source.min.y, source.min.z),
    new THREE.Vector3(source.min.x, source.min.y, source.max.z),
    new THREE.Vector3(source.min.x, source.max.y, source.min.z),
    new THREE.Vector3(source.min.x, source.max.y, source.max.z),
    new THREE.Vector3(source.max.x, source.min.y, source.min.z),
    new THREE.Vector3(source.max.x, source.min.y, source.max.z),
    new THREE.Vector3(source.max.x, source.max.y, source.min.z),
    new THREE.Vector3(source.max.x, source.max.y, source.max.z),
  ];

  for (const point of points) target.expandByPoint(point.applyMatrix4(matrix));
}

function sourceBounds(scene: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3();
  const sceneInverse = new THREE.Matrix4();
  const meshMatrix = new THREE.Matrix4();

  scene.updateMatrixWorld(true);
  sceneInverse.copy(scene.matrixWorld).invert();

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const geometryBox = mesh.geometry.boundingBox;
    if (!geometryBox || geometryBox.isEmpty()) return;

    meshMatrix.multiplyMatrices(sceneInverse, mesh.matrixWorld);
    expandByTransformedBox(bounds, geometryBox, meshMatrix);
  });

  return bounds;
}

function transformedBounds(source: THREE.Box3, matrix: THREE.Matrix4): THREE.Box3 {
  const bounds = new THREE.Box3();
  if (!source.isEmpty()) expandByTransformedBox(bounds, source, matrix);
  return bounds;
}

function shouldUseZUp(bounds: THREE.Box3): boolean {
  const size = bounds.getSize(new THREE.Vector3());
  return size.z > size.y;
}

function orientationMatrix(bounds: THREE.Box3, orientMode: SoulOrientMode, rotate: [number, number, number]): THREE.Matrix4 {
  const base = new THREE.Matrix4();
  const resolved = orientMode === 'auto' ? (shouldUseZUp(bounds) ? 'z-up' : 'y-up') : orientMode;

  if (resolved === 'z-up') {
    base.makeRotationX(-Math.PI / 2);
  } else if (resolved === 'flip-y') {
    base.makeScale(1, -1, 1);
  }

  const extra = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rotate[0]),
    THREE.MathUtils.degToRad(rotate[1]),
    THREE.MathUtils.degToRad(rotate[2]),
    'XYZ'
  ));
  return extra.multiply(base);
}

interface PreviewFit {
  matrix: THREE.Matrix4;
  offset: THREE.Vector3;
  scale: number;
}

/** Compute importer-facing orientation, centering, and scale without reparenting
 *  the loaded GLB during React render. R3F owns the actual primitive attachment. */
function buildPreviewFit(scene: THREE.Object3D, orientMode: SoulOrientMode, rotate: [number, number, number]): PreviewFit {
  const source = sourceBounds(scene);
  const matrix = orientationMatrix(source, orientMode, rotate);
  const box = transformedBounds(source, matrix);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = SOUL_TARGET_SPAN / maxDim;

  return {
    matrix,
    offset: center.multiplyScalar(-1),
    scale,
  };
}

/** The translucent vanilla reference: a faint sphere + wireframe cube at the
 *  stock span, so size/orientation read against a known shell. */
function VanillaReference() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[SOUL_TARGET_SPAN / 2, 24, 16]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(SOUL_TARGET_SPAN, SOUL_TARGET_SPAN, SOUL_TARGET_SPAN)]} />
        <lineBasicMaterial color="#f97316" transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

/** In-Canvas scene: owns the auto-spin group (a LOCAL ref so the hooks
 *  immutability lint is satisfied) and registers the thumbnail capture. */
function PreviewScene({
  sourceScene,
  fit,
  showVanilla,
  spinning,
  heroScene,
  heroFit,
  captureRef,
}: {
  sourceScene: THREE.Object3D;
  fit: PreviewFit;
  showVanilla: boolean;
  spinning: boolean;
  /** Optional standing hero rendered around the orb for scale + facing. */
  heroScene?: THREE.Object3D | null;
  heroFit?: HeroFit | null;
  captureRef?: MutableRefObject<(() => string | null) | null>;
}) {
  const spinGroup = useRef<THREE.Group>(null);
  const heroGroup = useRef<THREE.Group>(null);
  const vanillaRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const heroMode = !!(heroScene && heroFit);

  // In hero mode the orb holds its true (baked) facing toward the camera so it
  // reads against the hero; outside hero mode it free-spins.
  useLayoutEffect(() => {
    if (heroMode && spinGroup.current) spinGroup.current.rotation.y = 0;
  }, [heroMode]);

  useEffect(() => {
    if (!captureRef) return;
    // The saved card thumbnail is always the orb alone: freeze to a fixed yaw,
    // hide the orange reference shell AND the hero, and reset the camera to the
    // orb-only framing, then restore everything so the live view keeps going.
    captureRef.current = () => {
      const group = spinGroup.current;
      const vanilla = vanillaRef.current;
      const hero = heroGroup.current;
      const prevYaw = group ? group.rotation.y : 0;
      const prevVanillaVisible = vanilla ? vanilla.visible : false;
      const prevHeroVisible = hero ? hero.visible : false;
      const prevCamPos = camera.position.clone();
      try {
        if (group) {
          group.rotation.y = CAPTURE_YAW;
          group.updateMatrixWorld(true);
        }
        if (vanilla) vanilla.visible = false;
        if (hero) hero.visible = false;
        camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        if (group) group.rotation.y = prevYaw;
        if (vanilla) vanilla.visible = prevVanillaVisible;
        if (hero) hero.visible = prevHeroVisible;
        camera.position.copy(prevCamPos);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
      }
    };
    return () => {
      if (captureRef.current) captureRef.current = null;
    };
  }, [captureRef, gl, scene, camera]);

  useFrame((_, delta) => {
    if (!spinning || heroMode) return;
    const group = spinGroup.current;
    if (group) group.rotation.y += delta * SPIN_RATE;
  });

  return (
    <>
      <group ref={spinGroup}>
        <group scale={fit.scale}>
          <group position={fit.offset}>
            <group matrix={fit.matrix} matrixAutoUpdate={false}>
              <primitive object={sourceScene} dispose={null} />
            </group>
          </group>
        </group>
        {showVanilla && !heroMode && (
          <group ref={vanillaRef}>
            <VanillaReference />
          </group>
        )}
      </group>
      {heroMode && heroScene && heroFit && (
        // Hero wraps the orb (which stays at the origin = the back hip): turned
        // 180deg so the back faces the camera, dropped so the hip sits at y=0,
        // pushed back by its own half-depth so the back surface sits just behind
        // the orb (the orb pokes out toward the camera, not buried in the body),
        // and nudged sideways so the orb rests at one hip rather than dead-center.
        <group
          ref={heroGroup}
          position={[
            heroFit.halfWidth * HERO_HIP_SIDE - ORB_NUDGE_RIGHT,
            -HERO_PREVIEW_HEIGHT * HERO_HIP_FRACTION - ORB_NUDGE_UP,
            -(heroFit.halfDepth + ORB_BACK_PROUD),
          ]}
          rotation={[0, Math.PI, 0]}
        >
          <group scale={heroFit.scale}>
            <group position={heroFit.offset}>
              <primitive object={heroScene} dispose={null} />
            </group>
          </group>
        </group>
      )}
    </>
  );
}

export default function SoulImportPreview({
  scene,
  orientMode,
  rotate,
  showVanilla,
  spinning = true,
  backdropIndex = -1,
  heroScene = null,
  captureRef,
}: {
  /** The selected source GLB scene. */
  scene: THREE.Object3D;
  orientMode: SoulOrientMode;
  rotate: [number, number, number];
  showVanilla: boolean;
  /** Whether the model auto-rotates. Paused models hold their current angle. */
  spinning?: boolean;
  /** Index into SOUL_BACKDROPS for the baked background; < 0 for none. */
  backdropIndex?: number;
  /** Standing hero rendered beside the orb for a size + facing reference. */
  heroScene?: THREE.Object3D | null;
  captureRef?: MutableRefObject<(() => string | null) | null>;
}) {
  useLayoutEffect(() => {
    makeSourceMeshesVisible(scene);
    if (heroScene) makeSourceMeshesVisible(heroScene);
  }, [scene, heroScene]);

  const fit = useMemo(
    () => buildPreviewFit(scene, orientMode, rotate),
    [scene, orientMode, rotate]
  );
  const heroFit = useMemo(() => (heroScene ? buildHeroFit(heroScene) : null), [heroScene]);
  const heroMode = !!(heroScene && heroFit);

  return (
    <Canvas
      camera={{ position: [0, CAMERA_HEIGHT, CAMERA_DISTANCE], fov: 35 }}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
    >
      <PreviewCamera heroMode={heroMode} />
      <Backdrop index={backdropIndex} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 2]} intensity={1.3} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />
      {/* Faint accent rim from below/behind for a subtle soul glow. */}
      <pointLight position={[0, -SOUL_TARGET_SPAN, -SOUL_TARGET_SPAN]} intensity={0.6} color="#f97316" />
      <PreviewScene
        sourceScene={scene}
        fit={fit}
        showVanilla={showVanilla}
        spinning={spinning}
        heroScene={heroScene}
        heroFit={heroFit}
        captureRef={captureRef}
      />
    </Canvas>
  );
}
