import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleBundle } from '../../../lib/particles/host/bundle';
import { HeroParticleHost } from '../../../lib/particles/host/heroParticleHost';
import { bundleModelSource } from '../../../lib/particles/host/bundleSource';
import type { ParticleEffectHost } from '../../../lib/particles/host/effectHost';
import { Matrix4x4, Vector3 } from '../../../lib/particles/numerics';
import type { HeroPlaybackProgress } from '../../../lib/heroViewerPlayback';
import { BundleTextureSource } from './bundleTextures';
import { type ParticleDrawLayer, createParticleDrawLayer } from './particleDrawLayer';
import { SceneColorPass } from './sceneColor';
import { SceneDepthPass } from './sceneDepth';
import { ParticleField } from '../../../lib/particles/enums';
import type { ParticleSystemSimulation } from '../../../lib/particles/simulation';

/**
 * Runs a hero's bundled particle effects with the faithful Source 2 simulation on the animated rig.
 * The effects live in Source space (inches, Z up) under the GLB's `skeleton` node, which carries the
 * Source-to-viewer transform; bone poses are read relative to that node every frame and handed to the
 * simulation as System.Numerics matrices.
 */
export function SourceParticleLayer({ bundle, textureBaseUrl, model, playback, clipName, progressRef }: {
  bundle: ParticleBundle;
  textureBaseUrl: string;
  model: THREE.Object3D;
  playback: { paused: boolean; speed: number };
  clipName?: string;
  progressRef?: RefObject<HeroPlaybackProgress>;
}) {
  const state = useRef<{ host: HeroParticleHost; frame: THREE.Object3D; group: THREE.Group; bones: (THREE.Object3D | undefined)[]; layers: Map<ParticleEffectHost, ParticleDrawLayer> } | null>(null);
  const depthPass = useRef<SceneDepthPass | null>(null);
  const colorPass = useRef<SceneColorPass | null>(null);

  useEffect(() => {
    const frame = model.getObjectByName('skeleton') ?? model;
    const group = new THREE.Group();
    group.name = 'source particles';
    frame.add(group);
    const textures = new BundleTextureSource(bundle, textureBaseUrl);
    const models = bundleModelSource(bundle);
    const layers = new Map<ParticleEffectHost, ParticleDrawLayer>();
    const host = new HeroParticleHost(bundle, {
      added(effectHost) {
        const layer = createParticleDrawLayer(effectHost.simulation, textures, models);
        layers.set(effectHost, layer);
        group.add(layer.object3d);
        return layer.addControlPointDefaults;
      },
      removed(effectHost) {
        const layer = layers.get(effectHost);
        layers.delete(effectHost);
        if (!layer) return;
        group.remove(layer.object3d);
        layer.dispose();
      },
    });
    for (const failure of host.failures) console.warn('[SourceParticleLayer]', failure.effect.system, failure.error);

    // GLTFLoader keeps bone names, sanitizing only characters a property path cannot hold
    const byName = new Map<string, THREE.Object3D>();
    frame.traverse((object) => { if (object.name) byName.set(object.name.toLowerCase(), object); });
    const bones = host.boneNames.map((name) => byName.get(name.toLowerCase()) ?? byName.get(THREE.PropertyBinding.sanitizeNodeName(name).toLowerCase()));
    state.current = { host, frame, group, bones, layers };

    return () => {
      host.dispose();
      frame.remove(group);
      textures.dispose();
      depthPass.current?.dispose();
      depthPass.current = null;
      colorPass.current?.dispose();
      colorPass.current = null;
      state.current = null;
    };
  }, [bundle, textureBaseUrl, model]);

  const inverse = useRef(new THREE.Matrix4());
  const local = useRef(new THREE.Matrix4());
  const camera = useRef(new THREE.Vector3());
  const viewport = useRef(new THREE.Vector2());
  const uptime = useRef(0);

  useFrame((three, delta) => {
    const current = state.current;
    if (!current) return;
    const { host, frame, group, bones, layers } = current;

    // Bones in the Source frame: the frame's world inverse, then each bone's world
    frame.updateWorldMatrix(true, true);
    inverse.current.copy(frame.matrixWorld).invert();
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      host.pose.bones[i] = bone ? new Matrix4x4(local.current.multiplyMatrices(inverse.current, bone.matrixWorld).elements) : undefined;
    }

    three.camera.getWorldPosition(camera.current).applyMatrix4(inverse.current);
    const progress = progressRef?.current;
    host.setClip(clipName && progress ? { name: clipName, time: progress.time, duration: progress.duration } : null);
    host.update(delta, playback.speed, playback.paused, new Vector3(camera.current.x, camera.current.y, camera.current.z));

    // The opaque scene's depth, only while a feathering renderer draws (Graves and Rem as of 2026-10)
    three.gl.getDrawingBufferSize(viewport.current);
    const size: [number, number] = [viewport.current.x, viewport.current.y];
    let depth = null;

    if ([...layers.values()].some((layer) => layer.wantsSceneDepth)) {
      depthPass.current ??= new SceneDepthPass();
      depth = depthPass.current.render(three.gl, three.scene, three.camera, size, group);
    }

    if (!playback.paused) uptime.current += Math.min(delta, 0.1) * playback.speed;

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

    if (import.meta.env.DEV) publishScreenBounds(three.gl.domElement, three.camera, group, host);
  });

  return null;
}

const projected = new THREE.Vector3();

/**
 * Dev only: the canvas's `data-particle-bounds` holds the CSS pixel box of every live particle (left,
 * top, right, bottom), for the capture scripts to crop on an effect.
 */
function publishScreenBounds(canvas: HTMLCanvasElement, camera: THREE.Camera, group: THREE.Object3D, host: HeroParticleHost): void {
  const rect = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (system: ParticleSystemSimulation) => {
    const span = system.currentParticles;
    const positions = span.readVectors(ParticleField.Position);

    for (let i = 0; i < span.length; i++) {
      projected.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyMatrix4(group.matrixWorld).project(camera);
      if (projected.z > 1) continue;
      const x = (projected.x * 0.5 + 0.5) * canvas.clientWidth;
      const y = (0.5 - projected.y * 0.5) * canvas.clientHeight;
      rect[0] = Math.min(rect[0], x); rect[1] = Math.min(rect[1], y); rect[2] = Math.max(rect[2], x); rect[3] = Math.max(rect[3], y);
    }

    system.children.forEach(visit);
  };

  for (const effectHost of host.activeHosts) visit(effectHost.simulation);
  canvas.dataset.particleBounds = rect[0] <= rect[2] ? rect.map(Math.round).join(',') : '';
}
