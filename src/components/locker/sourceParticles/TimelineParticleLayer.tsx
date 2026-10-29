import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleBundle } from '../../../lib/particles/host/bundle';
import { bundleModelSource } from '../../../lib/particles/host/bundleSource';
import { EffectTimelinePlayer, type EffectTimeline, travelAt } from '../../../lib/particles/host/effectTimeline';
import type { ParticleEffectHost } from '../../../lib/particles/host/effectHost';
import { Matrix4x4, Vector3 } from '../../../lib/particles/numerics';
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
export function TimelineParticleLayer({ bundle, textureBaseUrl, timeline, model, playback, timeRef }: {
  bundle: ParticleBundle;
  textureBaseUrl: string;
  timeline: EffectTimeline;
  model: THREE.Object3D;
  playback: { paused: boolean; speed: number };
  timeRef: RefObject<number>;
}) {
  const state = useRef<{ player: EffectTimelinePlayer; frame: THREE.Object3D; group: THREE.Group; bones: (THREE.Object3D | undefined)[]; layers: Map<ParticleEffectHost, ParticleDrawLayer>; warmup: ParticleProgramWarmup } | null>(null);
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

  useEffect(() => {
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

    const byName = new Map<string, THREE.Object3D>();
    frame.traverse((object) => { if (object.name) byName.set(object.name.toLowerCase(), object); });
    const bones = player.boneNames.map((name) => byName.get(name.toLowerCase()) ?? byName.get(THREE.PropertyBinding.sanitizeNodeName(name).toLowerCase()));
    state.current = { player, frame, group, bones, layers, warmup };

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
  }, [bundle, textureBaseUrl, timeline, model]);

  const inverse = useRef(new THREE.Matrix4());
  const local = useRef(new THREE.Matrix4());
  const camera = useRef(new THREE.Vector3());
  const viewport = useRef(new THREE.Vector2());

  useFrame((three, delta) => {
    const current = state.current;
    if (!current) return;
    const { player, frame, group, bones, layers, warmup } = current;

    frame.updateWorldMatrix(true, true);
    inverse.current.copy(frame.matrixWorld).invert();
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      player.pose.bones[i] = bone ? new Matrix4x4(local.current.multiplyMatrices(inverse.current, bone.matrixWorld).elements) : undefined;
    }

    // The particle world is drawn moved back by the hero's travel; the camera sits there in it
    const time = timeRef.current ?? 0;
    const travel = travelAt(timeline, time);
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
