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
// Saved thumbnails freeze to this 3/4 yaw (instead of a random spin frame) so
// every card reads from a consistent, flattering angle.
const CAPTURE_YAW = -Math.PI * 0.18;
type SoulOrientMode = 'y-up' | 'z-up' | 'flip-y' | 'auto';

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

function PreviewCamera() {
  const camera = useThree((s) => s.camera);

  useLayoutEffect(() => {
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }, [camera]);

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
  captureRef,
}: {
  sourceScene: THREE.Object3D;
  fit: PreviewFit;
  showVanilla: boolean;
  spinning: boolean;
  captureRef?: MutableRefObject<(() => string | null) | null>;
}) {
  const spinGroup = useRef<THREE.Group>(null);
  const vanillaRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    if (!captureRef) return;
    // The saved thumbnail freezes to a fixed angle and drops the orange vanilla
    // reference (a sizing aid, not part of the model), then restores the live
    // spin/visibility so the preview keeps animating.
    captureRef.current = () => {
      const group = spinGroup.current;
      const vanilla = vanillaRef.current;
      const prevYaw = group ? group.rotation.y : 0;
      const prevVanillaVisible = vanilla ? vanilla.visible : false;
      try {
        if (group) {
          group.rotation.y = CAPTURE_YAW;
          group.updateMatrixWorld(true);
        }
        if (vanilla) vanilla.visible = false;
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        if (group) group.rotation.y = prevYaw;
        if (vanilla) vanilla.visible = prevVanillaVisible;
      }
    };
    return () => {
      if (captureRef.current) captureRef.current = null;
    };
  }, [captureRef, gl, scene, camera]);

  useFrame((_, delta) => {
    if (!spinning) return;
    const group = spinGroup.current;
    if (group) group.rotation.y += delta * SPIN_RATE;
  });

  return (
    <group ref={spinGroup}>
      <group scale={fit.scale}>
        <group position={fit.offset}>
          <group matrix={fit.matrix} matrixAutoUpdate={false}>
            <primitive object={sourceScene} dispose={null} />
          </group>
        </group>
      </group>
      {showVanilla && (
        <group ref={vanillaRef}>
          <VanillaReference />
        </group>
      )}
    </group>
  );
}

export default function SoulImportPreview({
  scene,
  orientMode,
  rotate,
  showVanilla,
  spinning = true,
  backdropIndex = -1,
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
  captureRef?: MutableRefObject<(() => string | null) | null>;
}) {
  useLayoutEffect(() => {
    makeSourceMeshesVisible(scene);
  }, [scene]);

  const fit = useMemo(
    () => buildPreviewFit(scene, orientMode, rotate),
    [scene, orientMode, rotate]
  );

  return (
    <Canvas
      camera={{ position: [0, SOUL_TARGET_SPAN * 0.35, CAMERA_DISTANCE], fov: 35 }}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
    >
      <PreviewCamera />
      <Backdrop index={backdropIndex} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 2]} intensity={1.3} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />
      {/* Faint accent rim from below/behind for a subtle soul glow. */}
      <pointLight position={[0, -SOUL_TARGET_SPAN, -SOUL_TARGET_SPAN]} intensity={0.6} color="#f97316" />
      <PreviewScene sourceScene={scene} fit={fit} showVanilla={showVanilla} spinning={spinning} captureRef={captureRef} />
    </Canvas>
  );
}
