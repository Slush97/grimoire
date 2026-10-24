import { expect, it } from 'vitest';
import * as THREE from 'three';
import { skinPartBounds } from './skinPartBounds';

it('frames indexed parts without including the rest of a shared vertex buffer', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 500,500,500], 3));
  geometry.setIndex([0,1,2]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: 'gun.vmat' }));
  mesh.position.set(3,2,1);
  expect(skinPartBounds(mesh, 'materials/gun.vmat').min.toArray()).toEqual([3,2,1]);
  expect(skinPartBounds(mesh, 'gun.vmat').max.toArray()).toEqual([4,3,1]);
  expect(skinPartBounds(mesh, 'coat.vmat').isEmpty()).toBe(true);
});

it('keeps other material groups out of the selected part', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 100,100,100], 3));
  geometry.setIndex([0,1,2,1,2,3]);
  geometry.addGroup(0,3,0);geometry.addGroup(3,3,1);
  const mesh = new THREE.Mesh(geometry, [new THREE.MeshStandardMaterial({name:'gun'}), new THREE.MeshStandardMaterial({name:'coat'})]);
  expect(skinPartBounds(mesh,'gun').max.toArray()).toEqual([1,1,0]);
});
