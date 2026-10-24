import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { particleAttachmentIssues, particleAttachmentToWorld, resolveParticleAttachment, resolveParticleControlPoint } from './particleAttachment';
import type { FxDescriptor } from './fxDescriptor';

const descriptor: FxDescriptor = {
  name: 'test', controlPoints: [{ cp: 2, attachType: 'PATTACH_POINT_FOLLOW', attachment: 'ability_cast', entity: 'self' }],
  emitters: [], initializers: [], operators: [], children: [],
  renderers: [{ class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: null, textures: [], params: {} }],
};

describe('particle attachment resolution', () => {
  it('places ordered ring vertices around the animated hand rather than the skeleton origin', () => {
    const model = new THREE.Group(), hand = new THREE.Bone(); model.add(hand); model.scale.setScalar(.0254);
    hand.position.set(10, 30, 50);
    const attachment: import('./particleAttachment').ParticleAttachmentResolution = { object: hand,
      frame: { name: 'palm_R', bone: 'hand_R', position: [2, 0, 0], rotation: [0, 0, 0, 1] }, kind: 'exact' };
    const point = particleAttachmentToWorld(attachment, new THREE.Vector3(4, 0, 0));
    expect(point.toArray()).toEqual([16 * .0254, 30 * .0254, 50 * .0254]);
    hand.position.y += 10;
    expect(particleAttachmentToWorld(attachment, new THREE.Vector3()).y).toBeCloseTo(40 * .0254);
  });
  it('matches the gameplay palm_r binding to the model palm_R frame', () => {
    const model = new THREE.Group(), right = new THREE.Bone(); right.name = 'hand_R'; model.add(right);
    const frame = { name: 'palm_R', bone: 'hand_R', position: [2, 0, 0], rotation: [0, 0, 0, 1] };
    model.userData.grimoireAttachments = [frame];
    expect(resolveParticleAttachment(model, 'palm_r')).toEqual({ object: right, frame, kind: 'exact' });
  });
  it('anchors absolute-origin particles at the actor root without requiring a bone', () => {
    const model = new THREE.Group();
    const spine = new THREE.Bone(); spine.name = 'spine_2'; model.add(spine);
    expect(resolveParticleControlPoint(model, { cp: 0, entity: 'self', attachType: 'PATTACH_ABSORIGIN_FOLLOW', attachment: null }, null))
      .toEqual({ object: model, kind: 'exact' });
  });
  it('uses the selected hero palm frame before a generic particle preview model frame', () => {
    const model = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'hand_R'; model.add(bone);
    const frame: import('../../types/modelAttachment').ModelAttachment = { name: 'palm_R', bone: 'hand_R', position: [2, 0, 0], rotation: [0, 0, 0, 1] };
    model.userData.grimoireAttachments = [frame];
    expect(resolveParticleAttachment(model, 'palm_R', [{ ...frame, position: [20, 0, 0] }]).frame).toBe(frame);
  });
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
