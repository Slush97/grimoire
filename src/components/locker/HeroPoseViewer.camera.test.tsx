import { useLayoutEffect } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Controls } from './HeroPoseViewer';

vi.mock('@react-three/drei', async () => {
  const { forwardRef, useImperativeHandle, useMemo } = await import('react');
  const { useThree } = await import('@react-three/fiber');
  return {
    OrbitControls: forwardRef(function TestOrbitControls(_props, ref) {
      const camera = useThree((state) => state.camera);
      const controls = useMemo(() => {
        const target = new THREE.Vector3();
        return { target, minDistance: 1.6, maxDistance: 6, update: () => { camera.lookAt(target); } };
      }, [camera]);
      useImperativeHandle(ref, () => controls, [controls]);
      return null;
    }),
  };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('hero preview camera fitting', () => {
  it.each(['static', 'skinned'])('fits the first %s pose and refits when the canvas narrows', async (kind) => {
    const model = new THREE.Group();
    const geometry = new THREE.BoxGeometry(80, 100, 20);
    const body = kind === 'skinned'
      ? new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
      : new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    body.position.y = 50;
    model.add(body);
    if (body instanceof THREE.SkinnedMesh) {
      const count = geometry.attributes.position.count;
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
      const weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) weights[i * 4] = 1;
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const anchor = new THREE.Bone();
      body.add(anchor);
      body.bind(new THREE.Skeleton([anchor]));
    }
    let state!: RootState;
    function Pose() {
      useFrame(() => { body.position.y = 60; });
      return <primitive object={model} />;
    }
    function Figure() {
      const current = useThree();
      useLayoutEffect(() => {
        state = current;
        // The test renderer's canvas omits DOM attributes used for accessibility.
        Object.assign(current.gl.domElement, { setAttribute: vi.fn() });
      }, [current]);
      return (
        <>
          <group scale={0.02}>
            <group position={[0, -50, 0]}><Pose /></group>
          </group>
          <Controls interaction={{ current: { dragging: false, paused: true } }}
            reset={0} label="camera" model={model} fitKey="hero" />
        </>
      );
    }
    const renderer = await ReactThreeTestRenderer.create(<Figure />, { width: 800, height: 600 });
    await renderer.advanceFrames(1, 1 / 60);
    const firstHome = state.camera.userData.previewHome as { position: number[]; target: number[] };
    expect(firstHome.target[1]).toBeCloseTo(0.2);
    const firstDistance = new THREE.Vector3().fromArray(firstHome.position)
      .distanceTo(new THREE.Vector3().fromArray(firstHome.target));
    expect(firstDistance).toBeGreaterThan(1.6);
    await ReactThreeTestRenderer.act(async () => { state.setSize(120, 800, 0, 0); });
    await renderer.advanceFrames(1, 1 / 60);
    const narrowHome = state.camera.userData.previewHome as { position: number[]; target: number[] };
    const narrowDistance = new THREE.Vector3().fromArray(narrowHome.position)
      .distanceTo(new THREE.Vector3().fromArray(narrowHome.target));
    expect(narrowDistance).toBeGreaterThan(firstDistance);
    expect(narrowDistance).toBeGreaterThan(6);
    expect(narrowHome.target[1]).toBeCloseTo(0.2);
    const camera = state.camera as THREE.PerspectiveCamera;
    const bounds = new THREE.Box3().setFromObject(model);
    camera.updateMatrixWorld();
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        const projected = new THREE.Vector3(x, y, bounds.max.z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
      }
    }
    await renderer.unmount();
  });
});
