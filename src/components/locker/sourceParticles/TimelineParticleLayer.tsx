import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleBundle } from '../../../lib/particles/host/bundle';
import { bundleModelSource } from '../../../lib/particles/host/bundleSource';
import { EffectTimelinePlayer, type EffectTimeline, travelAt } from '../../../lib/particles/host/effectTimeline';
import type { ParticleEffectHost } from '../../../lib/particles/host/effectHost';
import { Matrix4x4, Vector3 } from '../../../lib/particles/numerics';
import type { StagedActorMount } from '../StagedActors';
import { actorAt, actorSourceTransform } from '../../../lib/stagedActorPlacement';
import { BundleTextureSource } from './bundleTextures';
import { type ParticleDrawLayer, createParticleDrawLayer } from './particleDrawLayer';
import { SceneColorPass } from './sceneColor';
import { SceneDepthPass } from './sceneDepth';
import { ParticleProgramWarmup } from './particleProgramWarmup';

/**
 * Plays an effect timeline on the animated rig with the faithful Source 2 runtime. `timeRef` holds the
 * timeline's time (seconds), advanced by the owner with the rig. The effects live in a particle world
 * under the GLB's `skeleton` node (Source space); the hero travels through it as the timeline says,
 * and the world is drawn moved back by that travel, so the hero stays in frame while the effects it
 * left behind move past, as the game's camera follows its player.
 */
export function TimelineParticleLayer({ bundle, textureBaseUrl, timeline, model, playback, timeRef, actors = [] }: {
  bundle: ParticleBundle;
  textureBaseUrl: string;
  timeline: EffectTimeline;
  model: THREE.Object3D;
  playback: { paused: boolean; speed: number };
  timeRef: RefObject<number>;
  /** Other heroes the timeline stages, whose bones the effects bound to them follow. */
  actors?: StagedActorMount[];
}) {
  const state = useRef<{
    bundle: ParticleBundle; textures: BundleTextureSource; player: EffectTimelinePlayer; frame: THREE.Object3D; group: THREE.Group; bones: (THREE.Object3D | undefined)[]; layers: Map<ParticleEffectHost, ParticleDrawLayer>; warmup: ParticleProgramWarmup;
    actors: { mount: StagedActorMount; frame: THREE.Object3D; bones: (THREE.Object3D | undefined)[] }[];
  } | null>(null);
  const depthPass = useRef<SceneDepthPass | null>(null);
  const colorPass = useRef<SceneColorPass | null>(null);
  const uptime = useRef(0);

  const getThree = useThree((three) => three.get);

  useEffect(() => {
    // Dev only: tells the capture scripts the engine preview is running
    if (!import.meta.env.DEV) return;
    const { dataset } = getThree().gl.domElement;
    dataset.movementEngine = 'ready';
    return () => { delete dataset.movementEngine; };
  }, [getThree]);

  // A live recolour hands over a bundle with other definitions and the same models: the running effects
  // take them where they are. Another hero's bundle (other models) starts the layer over
  const bundleRef = useRef(bundle);
  const structure = bundle.model;
  useLayoutEffect(() => {
    bundleRef.current = bundle;
    const current = state.current;
    if (!current || current.bundle === bundle || current.bundle.model !== bundle.model) return;
    current.textures.setBundle(bundle);
    current.player.setBundle(bundle);
    current.bundle = bundle;
  }, [bundle]);

  useEffect(() => {
    const bundle = bundleRef.current;
    const frame = model.getObjectByName('skeleton') ?? model;
    const group = new THREE.Group();
    group.name = 'timeline particles';
    frame.add(group);
    const textures = new BundleTextureSource(bundle, textureBaseUrl);
    const models = bundleModelSource(bundle);
    const warmup = new ParticleProgramWarmup();
    const layers = new Map<ParticleEffectHost, ParticleDrawLayer>();
    const player = new EffectTimelinePlayer(bundle, timeline, {
      added(host) {
        const layer = createParticleDrawLayer(host.simulation, textures, models);
        for (const light of layer.lights) light.deferNewLights();
        warmup.track(layer.object3d);
        layers.set(host, layer);
        group.add(layer.object3d);
        return layer.addControlPointDefaults;
      },
      removed(host) {
        const layer = layers.get(host);
        layers.delete(host);
        if (!layer) return;
        group.remove(layer.object3d);
        layer.dispose();
      },
    });

    const bonesOf = (root: THREE.Object3D, names: string[]) => {
      const byName = new Map<string, THREE.Object3D>();
      root.traverse((object) => { if (object.name) byName.set(object.name.toLowerCase(), object); });
      return names.map((name) => byName.get(name.toLowerCase()) ?? byName.get(THREE.PropertyBinding.sanitizeNodeName(name).toLowerCase()));
    };
    const bones = bonesOf(frame, player.boneNames);
    const staged = actors.flatMap((mount) => {
      const actor = timeline.actors?.find((candidate) => candidate.id === mount.id);
      if (!actor || !player.actorPose(mount.id)) return [];
      const actorFrame = mount.scene.getObjectByName('skeleton') ?? mount.scene;
      return [{ mount, frame: actorFrame, bones: bonesOf(actorFrame, player.actorBoneNames(mount.id)) }];
    });
    // A new bundle (a recolour) joins the loop where it is; a replay or loop round starts it over
    player.seek(timeRef.current ?? 0);
    state.current = { bundle, textures, player, frame, group, bones, layers, warmup, actors: staged };

    return () => {
      warmup.dispose();
      player.dispose();
      for (const failure of player.failures) console.warn('[TimelineParticleLayer]', failure.cue.system, failure.error);
      frame.remove(group);
      textures.dispose();
      depthPass.current?.dispose();
      depthPass.current = null;
      colorPass.current?.dispose();
      colorPass.current = null;
      state.current = null;
    };
  }, [structure, textureBaseUrl, timeline, model, actors, timeRef]);

  const inverse = useRef(new THREE.Matrix4());
  const actorInverse = useRef(new THREE.Matrix4());
  const local = useRef(new THREE.Matrix4());
  const camera = useRef(new THREE.Vector3());
  const viewport = useRef(new THREE.Vector2());

  useFrame((three, delta) => {
    const current = state.current;
    if (!current) return;
    const { player, frame, group, bones, layers, warmup, actors: staged } = current;

    frame.updateWorldMatrix(true, true);
    inverse.current.copy(frame.matrixWorld).invert();
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      player.pose.bones[i] = bone ? new Matrix4x4(local.current.multiplyMatrices(inverse.current, bone.matrixWorld).elements) : undefined;
    }

    // The particle world is drawn moved back by the hero's travel; the camera sits there in it
    const time = timeRef.current ?? 0;
    const travel = travelAt(timeline, time);

    // Each staged actor's bones, in its own model space
    for (const actor of staged) {
      const pose = player.actorPose(actor.mount.id)!;
      actor.frame.updateWorldMatrix(true, true);
      actorInverse.current.copy(actor.frame.matrixWorld).invert();
      for (let i = 0; i < actor.bones.length; i++) {
        const bone = actor.bones[i];
        pose.bones[i] = bone ? new Matrix4x4(local.current.multiplyMatrices(actorInverse.current, bone.matrixWorld).elements) : undefined;
      }
    }
    // Each actor where the timeline stands it in the particle world at this time (moved by its own travel);
    // one without a rig on screen too, in its bind pose
    for (const actor of timeline.actors ?? []) {
      const pose = player.actorPose(actor.id);
      if (pose) pose.transform = actorSourceTransform(actorAt(timeline, actor, time));
    }
    three.camera.getWorldPosition(camera.current).applyMatrix4(inverse.current);
    player.update(time, delta, playback.speed, playback.paused, new Vector3(camera.current.x + travel, camera.current.y, camera.current.z));
    group.position.set(-travel, 0, 0);
    group.updateMatrixWorld(true);
    if (!playback.paused) uptime.current += Math.min(delta, 0.1) * playback.speed;

    three.gl.getDrawingBufferSize(viewport.current);
    const size: [number, number] = [viewport.current.x, viewport.current.y];
    let depth = null;

    if ([...layers.values()].some((layer) => layer.wantsSceneDepth)) {
      depthPass.current ??= new SceneDepthPass();
      depth = depthPass.current.render(three.gl, three.scene, three.camera, size, group);
    }

    // The opaque scene's colour, only while a refracting renderer draws (the heavy melee swing and impact)
    let color = null;

    if ([...layers.values()].some((layer) => layer.wantsSceneColor)) {
      colorPass.current ??= new SceneColorPass();
      color = colorPass.current.render(three.gl, three.scene, three.camera, size, group);
    }

    for (const layer of layers.values()) {
      layer.setScene(depth, color);
      layer.update(three.camera, size, uptime.current);
    }
    warmup.update(three.gl, three.scene, three.camera, group);
  });

  return null;
}
