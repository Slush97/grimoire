// The camera a particle renderer draws through, in Source space (VRF's Camera as the renderers read it).
//
// The renderers work in the coordinates the simulation computes in. The host places the tree's root
// under its Source-to-viewer transform, so the camera is brought into Source space through the
// inverse of the root's world matrix.

import * as THREE from 'three';
import { Vector3 } from '../numerics';

export interface RenderView {
  /** Where the camera is, in Source space. */
  location: Vector3;
  /** The unit direction the camera looks along. */
  forward: Vector3;
  /** The camera's unit right and up axes. */
  right: Vector3;
  up: Vector3;
  /** The projection's vertical scale, 1 / tan(fovY / 2) (ProjectionMatrix.M22). */
  projectionM22: number;
  /** The drawing buffer size in pixels. */
  windowSize: [number, number];
  /** How many Source units one viewer unit spans along the view, for converting the camera's depth range. */
  sourceUnitsPerViewerUnit: number;
}

const inverseRoot = new THREE.Matrix4();
const cameraInSource = new THREE.Matrix4();
const column = new THREE.Vector3();

/** The view `camera` gives of a tree whose root has the world matrix `rootMatrixWorld`. */
export function viewFromCamera(camera: THREE.Camera, rootMatrixWorld: THREE.Matrix4, windowSize: [number, number]): RenderView {
  inverseRoot.copy(rootMatrixWorld).invert();
  cameraInSource.multiplyMatrices(inverseRoot, camera.matrixWorld);

  const e = cameraInSource.elements;
  const axis = (index: number) => {
    column.set(e[index * 4], e[index * 4 + 1], e[index * 4 + 2]);
    const length = column.length();
    return { vector: new Vector3(column.x / length, column.y / length, column.z / length), length };
  };

  const right = axis(0);
  const up = axis(1);
  const back = axis(2);

  return {
    location: new Vector3(e[12], e[13], e[14]),
    forward: back.vector.negate(),
    right: right.vector,
    up: up.vector,
    projectionM22: camera.projectionMatrix.elements[5],
    windowSize,
    sourceUnitsPerViewerUnit: back.length,
  };
}
