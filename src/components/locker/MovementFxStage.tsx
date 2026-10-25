import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { ParticleEffect } from './ParticleEffect';
import type { MovementFxPreview, MovementFxChoice } from '../../lib/movementFx';
import { movementFrame, MOVEMENT_DISTANCE } from '../../lib/movementMotion';
import { MovementClock } from '../../lib/movementClock';

export interface MovementViewerPreview extends MovementFxPreview {
  kind: MovementFxChoice['kind']; revision: number; loop: boolean;
}

/** Moves the actor independently of the emitters' history: old particles stay
 * where they spawned rather than being dragged along with the hero. */
export function MovementFxStage({ preview, scene, paused, speed, children, controls }: {
  preview?: MovementViewerPreview; scene: THREE.Object3D; paused: boolean; speed: number; children: ReactNode; controls?: ReactNode;
}) {
  const source = preview?.descriptor, kind = preview?.kind;
  const descriptor = useMemo(() => {
    if (!source) return null;
    const duration = kind === 'dash' ? .45 : .55;
    const bound = (node: typeof source): typeof source => ({ ...node,
      emitters: node.emitters.map(emitter => emitter.class === 'C_OP_ContinuousEmitter' ? { ...emitter,
        params: { ...emitter.params, m_flEmissionDuration: Math.min(duration,
          typeof emitter.params.m_flEmissionDuration === 'number' && emitter.params.m_flEmissionDuration > 0 ? emitter.params.m_flEmissionDuration : duration) } } : emitter),
      children: node.children.map(bound),
    });
    return { ...bound(source), startDelay: (source.startDelay ?? 0) + (kind === 'dash' ? .5 : .35) };
  }, [source, kind]);
  const returnDescriptor = useMemo(() => kind === 'dash' && descriptor
    ? { ...descriptor, startDelay: (descriptor.startDelay ?? 0) + 1.7 } : null, [descriptor, kind]);
  const actor = useRef<THREE.Group>(null);
  const effects = useRef<THREE.Group>(null);
  const scale = useRef(new THREE.Vector3());
  const motionDirection = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const returnDirection = useMemo(() => new THREE.Vector3(-1, 0, 0), []);
  const elapsed = useRef(0);
  const cycle = useRef(0);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    elapsed.current = 0; cycle.current = 0;
    if (actor.current) {
      actor.current.position.set(kind === 'dash' ? -MOVEMENT_DISTANCE / 2 : 0, 0, 0);
      actor.current.rotation.y = kind === 'dash' ? Math.PI / 2 : 0;
      actor.current.updateMatrixWorld(true);
    }
  }, [kind, preview?.key, preview?.revision]);
  useFrame((_, delta) => {
    if (effects.current && scene.parent) effects.current.scale.copy(scene.parent.getWorldScale(scale.current));
    if (!preview || !actor.current || paused) return;
    elapsed.current += Math.min(delta, 0.1) * speed;
    const frame = movementFrame(preview.kind, elapsed.current, preview.loop);
    const round = frame.cycle;
    if (round !== cycle.current) { cycle.current = round; setGeneration((value) => value + 1); }
    if (preview.kind === 'dash') {
      actor.current.position.x = frame.distance - MOVEMENT_DISTANCE / 2;
      actor.current.position.y = 0;
      actor.current.rotation.y = Math.PI / 2;
    } else { actor.current.position.set(0, 0, 0); actor.current.rotation.y = 0; }
    actor.current.updateMatrixWorld(true);
  }, -2);
  return <MovementClock.Provider value={elapsed}>
    {controls}
    <group ref={actor}>{children}</group>
    <group ref={effects}>{preview && descriptor && <ParticleEffect key={`${preview.key}:${preview.revision}:${generation}`} descriptor={descriptor}
      textureBaseUrl={preview.textureBaseUrl} model={scene} playback={{ paused, speed }} motionDirection={preview.kind === 'dash' ? motionDirection : undefined} />}
      {preview && returnDescriptor && <ParticleEffect key={`return:${preview.key}:${preview.revision}:${generation}`} descriptor={returnDescriptor}
        textureBaseUrl={preview.textureBaseUrl} model={scene} playback={{ paused, speed }} motionDirection={returnDirection} />}</group>
  </MovementClock.Provider>;
}
