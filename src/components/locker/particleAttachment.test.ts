import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { particleAttachmentIssues, resolveParticleAttachment } from './particleAttachment';
import type { FxDescriptor } from './fxDescriptor';

const descriptor: FxDescriptor = {
  name: 'test', controlPoints: [{ cp: 2, attachType: 'PATTACH_POINT_FOLLOW', attachment: 'ability_cast', entity: 'self' }],
  emitters: [], initializers: [], operators: [], children: [],
  renderers: [{ class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: null, textures: [], params: {} }],
};

describe('particle attachment resolution', () => {
  it('uses authored bone-local frames without guessing the hand or mutating the skeleton', () => {
    const model = new THREE.Group();
    const left = new THREE.Bone(); left.name = 'hand_L';
    const right = new THREE.Bone(); right.name = 'hand_R'; model.add(left, right);
    model.scale.setScalar(0.0254); left.position.set(10, 20, 30);
    const frame = { name: 'ability_cast', bone: 'hand_L', position: [6.5, 3.2, -1.6], rotation: [0, 0, 0, 1] };
    model.userData.grimoireAttachments = [frame];
    expect(resolveParticleAttachment(model, 'ability_cast')).toEqual({ object: left, kind: 'exact', frame });
    expect(particleAttachmentIssues(descriptor, model)).toEqual([]);
    expect(left.children).toHaveLength(0);
    const point = left.localToWorld(new THREE.Vector3(...frame.position));
    expect(point.x).toBeCloseTo(16.5 * 0.0254);
    expect(point.y).toBeCloseTo(23.2 * 0.0254);
    expect(point.z).toBeCloseTo(28.4 * 0.0254);
  });
  it('marks the unsided right-hand fallback as approximate and prioritizes exact authored nodes', () => {
    const model = new THREE.Group();
    const right = new THREE.Bone(); right.name = 'hand_R';
    const left = new THREE.Bone(); left.name = 'hand_L'; model.add(right, left);
    expect(resolveParticleAttachment(model, 'ability_cast')).toEqual({ object: right, kind: 'fallback' });
    expect(resolveParticleAttachment(model, 'ability_cast_left')).toEqual({ object: left, kind: 'fallback' });
    expect(particleAttachmentIssues(descriptor, model)).toEqual([{ system: 'test', class: 'control-point', reason: 'attachment-fallback' }]);
    const exact = new THREE.Object3D(); exact.name = 'ability_cast'; left.add(exact);
    expect(resolveParticleAttachment(model, 'ability_cast')).toEqual({ object: exact, kind: 'exact' });
    expect(particleAttachmentIssues(descriptor, model)).toEqual([]);
  });
  it('reports missing named attachments and bounds repeated child diagnostics', () => {
    const model = new THREE.Group();
    expect(resolveParticleAttachment(model, 'ability_cast')).toEqual({ object: null, kind: 'missing' });
    const tree = { ...descriptor, children: [descriptor, descriptor] };
    expect(particleAttachmentIssues(tree, model)).toEqual([{ system: 'test', class: 'control-point', reason: 'missing-attachment' }]);
    expect(resolveParticleAttachment(model, null)).toEqual({ object: null, kind: 'origin' });
  });
});
