// Where a staged actor (another hero a movement timeline places beside the previewed one) stands: in the
// hero's Source space for the particle runtime, and under the hero's GLB scene for the viewer.

import * as THREE from 'three';
import { type EffectTimeline, type TimelineActor, travelAt } from './particles/host/effectTimeline';
import { Matrix4x4, Vector3 } from './particles/numerics';

/** An actor's place in the hero's model space (Source inches), as the particle runtime takes a model transform. */
export function actorSourceTransform(actor: TimelineActor): Matrix4x4 {
  const cos = Math.cos(actor.yaw), sin = Math.sin(actor.yaw);
  return Matrix4x4.createBasis(new Vector3(cos, sin, 0), new Vector3(-sin, cos, 0), new Vector3(0, 0, 1)).withTranslation(new Vector3(...actor.position));
}

/** Where an actor stands at `time`, in the hero's model space: its start, moved forward by its travel. */
export function actorAt(timeline: EffectTimeline, actor: TimelineActor, time: number): TimelineActor {
  const travel = travelAt(timeline, time, actor.id);
  if (travel === 0) return actor;
  const [x, y, z] = actor.position;
  return { ...actor, position: [x + Math.cos(actor.yaw) * travel, y + Math.sin(actor.yaw) * travel, z] };
}

/**
 * How far an actor is drawn from where it starts at `time`, in the hero's Source space: moved by its own
 * travel, and back by the hero's (the hero stays in frame while it travels through the world).
 */
export function actorShiftAt(timeline: EffectTimeline, actor: TimelineActor, time: number): [number, number, number] {
  const moved = actorAt(timeline, actor, time).position;
  return [moved[0] - actor.position[0] - travelAt(timeline, time), moved[1] - actor.position[1], moved[2] - actor.position[2]];
}

/** The times a timeline's travel turns at: its ends and every leg's, where a framing must hold everyone. */
export function travelTurns(timeline: EffectTimeline): number[] {
  return [...new Set([0, timeline.duration, ...timeline.travel.flatMap((leg) => [leg.start, leg.start + leg.duration])])].filter((time) => time >= 0 && time <= timeline.duration);
}

/** A GLB scene's Source to viewer transform: its `skeleton` node, relative to the scene. */
export function sourceFrame(scene: THREE.Object3D): THREE.Matrix4 {
  const node = scene.getObjectByName('skeleton');
  if (!node) return new THREE.Matrix4();
  node.updateWorldMatrix(true, false);
  scene.updateWorldMatrix(true, false);
  return new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(node.matrixWorld);
}

/**
 * The actor's placement under the hero's scene: each GLB carries its Source to viewer transform on its
 * `skeleton` node, so the actor's Source frame is mapped onto the hero's Source frame and back.
 */
export function actorPlacement(heroScene: THREE.Object3D, actorScene: THREE.Object3D, actor: TimelineActor): THREE.Matrix4 {
  // Matrix4x4 (row vectors, row major) and THREE.Matrix4 (column vectors, column major) share a layout
  const source = new THREE.Matrix4().fromArray(actorSourceTransform(actor).m);
  return sourceFrame(heroScene).multiply(source).multiply(sourceFrame(actorScene).invert());
}

/**
 * The placement moved by `shift` (actorShiftAt), Source inches in the hero's model space: the actor's own
 * travel, less the hero's.
 */
export function actorPlacementAt(placement: THREE.Matrix4, heroSourceFrame: THREE.Matrix4, shift: readonly [number, number, number], out = new THREE.Matrix4()): THREE.Matrix4 {
  if (shift[0] === 0 && shift[1] === 0 && shift[2] === 0) return out.copy(placement);
  const moved = new THREE.Matrix4().makeTranslation(shift[0], shift[1], shift[2]);
  return out.copy(heroSourceFrame).multiply(moved).multiply(new THREE.Matrix4().copy(heroSourceFrame).invert()).multiply(placement);
}
