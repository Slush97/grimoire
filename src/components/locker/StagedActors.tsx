import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ClothModel } from '../../lib/feModel';
import { preferredHeroAnimation } from '../../lib/heroAnimationCatalog';
import { clipWeightsAt, type EffectTimeline, type TimelineActorId } from '../../lib/particles/host/effectTimeline';
import { actorPlacementAt, actorShiftAt } from '../../lib/stagedActorPlacement';
import { useClothSim } from '../../lib/useClothSim';

/**
 * Another hero a movement timeline stages beside the previewed one (the attacker a parry catches),
 * loaded as a rig like the hero and placed in the hero's model space.
 */
export interface StagedActorMount {
  id: TimelineActorId;
  hero: string;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Its cloth (a coat, a cape), simulated as the hero's is; null when its rig has none. */
  clothModel: ClothModel | null;
  /** Its placement in the hero's GLB space, from the actor's place in the hero's Source space (no travel yet). */
  placement: THREE.Matrix4;
  /** The hero's Source to viewer transform, to move the placement by the hero's travel. */
  heroSourceFrame: THREE.Matrix4;
}

/**
 * The actor's rig, playing its clips of the timeline over its idle pose, with its cloth simulated as the
 * hero's is. The cloth starts over with each run of the timeline, as the hero's does with each replay.
 */
export function StagedActorModel({ mount, timeline, timeRef, clothEnabled }: {
  mount: StagedActorMount; timeline: EffectTimeline; timeRef: RefObject<number>; clothEnabled: boolean;
}) {
  const actions = useRef(new Map<string, THREE.AnimationAction>());
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const holder = useRef<THREE.Group>(null);
  const [run, setRun] = useState(0);
  const clothStep = useClothSim(mount.scene, clothEnabled ? mount.clothModel : null, `${run}`);
  /** The time the actor is posed at; it follows the timeline in the cloth's substeps. */
  const sampled = useRef(0);

  useEffect(() => {
    const created = new THREE.AnimationMixer(mount.scene);
    const valid = mount.clips.filter((clip) => Number.isFinite(clip.duration) && clip.duration > 0.001);
    const standing = valid.find((clip) => clip.name === 'movement_standing') ?? preferredHeroAnimation(valid, mount.hero);
    const map = new Map<string, THREE.AnimationAction>();
    if (standing) map.set('standing', created.clipAction(standing).setEffectiveWeight(1).play());
    for (const name of new Set(timeline.clips.filter((segment) => segment.actor === mount.id).map((segment) => segment.clip))) {
      const clip = valid.find((candidate) => candidate.name === name);
      if (clip) map.set(name, created.clipAction(clip).setEffectiveWeight(0).play());
    }
    actions.current = map;
    mixer.current = created;
    created.update(0);
    return () => { created.stopAllAction(); created.uncacheRoot(mount.scene); mixer.current = null; map.clear(); };
  }, [mount, timeline]);

  const pose = useCallback((time: number) => {
    const weights = clipWeightsAt(timeline, time, mount.id);
    for (const { clip, weight, time: clipTime } of weights.clips) {
      const action = actions.current.get(clip);
      if (!action) continue;
      action.enabled = true;
      action.setEffectiveWeight(weight);
      action.time = Math.max(0, Math.min(action.getClip().duration - 1e-6, clipTime));
    }
    const idle = actions.current.get('standing');
    // Clips the actor lacks leave their weight to the idle pose
    const missing = weights.clips.filter(({ clip }) => !actions.current.has(clip)).reduce((sum, { weight }) => sum + weight, 0);
    if (idle) { idle.enabled = true; idle.setEffectiveWeight(weights.idle + missing); idle.time = time % idle.getClip().duration; }
    mixer.current?.update(0);
    mount.scene.updateMatrixWorld(true);
  }, [timeline, mount]);

  // After the hero has moved the timeline on (priority -1), before the particles read the actor's bones (0)
  useFrame(() => {
    const target = timeRef.current ?? 0;
    // Where it stands in the world (its own travel), while the hero travels too
    const group = holder.current;
    const actor = timeline.actors?.find((candidate) => candidate.id === mount.id);
    if (group && actor) {
      actorPlacementAt(mount.placement, mount.heroSourceFrame, actorShiftAt(timeline, actor, target), group.matrix);
      group.matrixWorldNeedsUpdate = true;
    }
    if (target < sampled.current - 1e-3) {
      // The timeline came round: the actor starts over, and so does its cloth
      sampled.current = target;
      pose(target);
      setRun((value) => value + 1);
      return;
    }
    const step = target - sampled.current;
    if (step <= 0) return;
    clothStep(step, (dt) => {
      sampled.current = Math.min(target, sampled.current + dt);
      pose(sampled.current);
    });
  }, -0.5);

  return <group ref={holder} matrixAutoUpdate={false} matrix={mount.placement}><primitive object={mount.scene} /></group>;
}
