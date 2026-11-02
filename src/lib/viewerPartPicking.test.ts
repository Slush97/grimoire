// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { attachViewerPartPicker } from './viewerPartPicking';

function pointer(canvas: HTMLElement, type: string, x = 100, y = 100, button = 0, pointerId = 1, isPrimary = true) {
  canvas.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, button, pointerId, isPrimary }));
}

function setup() {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.position.z = 3; camera.lookAt(0, 0, 0);
  const scene = new THREE.Group();
  const material = new THREE.MeshBasicMaterial(); material.name = 'body.vmat';
  const mesh = new THREE.Mesh<THREE.BoxGeometry, THREE.Material | THREE.Material[]>(new THREE.BoxGeometry(1, 1, 1), material); scene.add(mesh);
  const raycast = vi.spyOn(mesh, 'raycast');
  const pick = vi.fn();
  const detach = attachViewerPartPicker(canvas, scene, camera, pick);
  return { canvas, camera, scene, mesh, material, raycast, pick, detach };
}

afterEach(() => vi.restoreAllMocks());

describe('viewer part picking', () => {
  it('does no hit tests on press, orbit drags returning to their origin, or right-button panning', () => {
    const { canvas, raycast, pick, detach } = setup();
    pointer(canvas, 'pointerdown');
    expect(raycast).not.toHaveBeenCalled();
    pointer(canvas, 'pointermove', 150, 140);
    pointer(canvas, 'pointermove');
    pointer(canvas, 'pointerup');
    pointer(canvas, 'pointerdown', 100, 100, 2);
    pointer(canvas, 'pointermove', 150, 140, 2);
    pointer(canvas, 'pointerup', 150, 140, 2);
    expect(raycast).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    detach();
  });
  it('picks once on a genuine primary click and never selects on the following native click', () => {
    const { canvas, pick, detach } = setup();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100 }));
    expect(pick).toHaveBeenCalledExactlyOnceWith('body.vmat', expect.objectContaining({ material: 'body.vmat' }));
    detach();
  });
  it('ignores cancelled and multi-pointer gestures', () => {
    const { canvas, raycast, pick, detach } = setup();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointercancel'); pointer(canvas, 'pointerup');
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerdown', 100, 100, 0, 2, false); pointer(canvas, 'pointerup');
    expect(raycast).not.toHaveBeenCalled(); expect(pick).not.toHaveBeenCalled(); detach();
  });
  it('picks through a hidden material and ignores invisible ancestors', () => {
    const { canvas, scene, pick, detach } = setup();
    const hidden = new THREE.MeshBasicMaterial({ visible: false }); hidden.name = 'hidden.vmat';
    const front = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hidden); front.position.z = .5; scene.add(front);
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    expect(pick).toHaveBeenLastCalledWith('body.vmat', expect.objectContaining({ material: 'body.vmat' }));
    pick.mockClear(); scene.visible = false;
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    expect(pick).not.toHaveBeenCalled(); detach();
  });
  it('selects the hit face material on a mesh with multiple materials', () => {
    const { canvas, mesh, pick, detach } = setup();
    const materials = Array.from({ length: 6 }, (_, index) => {
      const material = new THREE.MeshBasicMaterial(); material.name = `face-${index}.vmat`; return material;
    });
    mesh.material = materials;
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    expect(pick).toHaveBeenCalledExactlyOnceWith('face-4.vmat', expect.objectContaining({ material: 'face-4.vmat' })); detach();
  });
  it('removes all input listeners on cleanup', () => {
    const { canvas, raycast, pick, detach } = setup(); detach();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    expect(raycast).not.toHaveBeenCalled(); expect(pick).not.toHaveBeenCalled();
  });
});
