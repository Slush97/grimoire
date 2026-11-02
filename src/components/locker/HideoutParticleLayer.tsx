import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HideoutSceneInfo } from '../../types/skinEditor';
import type { ParticleBundle } from '../../lib/particles/host/bundle';
import { bundleDefinitionSource, bundleModelSource } from '../../lib/particles/host/bundleSource';
import { placeMapParticle } from '../../lib/particles/host/mapParticleHost';
import { ParticleSystemSimulation } from '../../lib/particles/simulation';
import { ControlPointDefaults } from '../../lib/particles/controlPointDefaults';
import { Vector3 } from '../../lib/particles/numerics';
import { SOURCE_TO_GLTF } from '../../lib/hideoutTransform';
import { BundleTextureSource } from './sourceParticles/bundleTextures';
import { createParticleDrawLayer, type ParticleDrawLayer } from './sourceParticles/particleDrawLayer';
import { SceneDepthPass } from './sourceParticles/sceneDepth';
import { SceneColorPass } from './sourceParticles/sceneColor';
import type { Source2ParticleLights } from '../../lib/source2DynamicLights';

/** Map-authored particles run in the same Source frame as the room, outside the hero rig. Their
 *  lights shine through the map's light model (`lights`), not as three.js lights. */
export function HideoutParticleLayer({ info, parent, lights, active = true }: { info: HideoutSceneInfo; parent: THREE.Group; lights: Source2ParticleLights;
  /** False pauses the simulation while the room is hidden. */
  active?: boolean }) {
  const current = useRef<{
    group: THREE.Group; textures: BundleTextureSource;
    systems: { entity: HideoutSceneInfo['particles']['entities'][number]; simulation: ParticleSystemSimulation; layer: ParticleDrawLayer }[];
    depth: SceneDepthPass | null; color: SceneColorPass | null; time: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const group = new THREE.Group();
    group.name = 'hideout particles';
    group.applyMatrix4(SOURCE_TO_GLTF);
    parent.add(group);
    const base = `grimoire-hero://s/${info.key}/particles/`;
    void fetch(`${base}bundle.json`).then(response => {
      if (!response.ok) throw new Error('Missing map particle bundle.');
      return response.json() as Promise<ParticleBundle>;
    }).then(bundle => {
      if (cancelled) return;
      const textures = new BundleTextureSource(bundle, `${base}tex/`);
      const state: NonNullable<typeof current.current> = { group, textures, systems: [], depth: null, color: null, time: 0 };
      current.current = state;
      const source = bundleDefinitionSource(bundle), models = bundleModelSource(bundle);
      const sun = info.lights.find(light => light.distribution.kind === 'sun');
      const color = sun ? new THREE.Color().setRGB(sun.color[0] / 255, sun.color[1] / 255, sun.color[2] / 255)
        .convertSRGBToLinear().multiplyScalar(sun.distribution.brightness) : new THREE.Color(0, 0, 0);
      const sunColor: [number, number, number] = [color.r, color.g, color.b];
      const failures: { system: string; reason: unknown }[] = [];
      for (const entity of info.particles.entities) {
        if (!entity.startActive) continue;
        // Match the room geometry's 65 metre neighborhood, including effects in adjacent rooms.
        if (Math.hypot(...entity.matrix.slice(12, 15).map((value, index) => (value - info.anchor[index]) * 0.0254)) > 65) continue;
        if (entity.issues.length) { failures.push({ system: entity.system, reason: entity.issues }); continue; }
        try {
          const loaded = source.loadSystem(entity.system);
          if (!loaded) throw new Error('Particle system is absent from the bundle.');
          const simulation = new ParticleSystemSimulation(loaded, source);
          const layer = createParticleDrawLayer(simulation, textures, models, false, { sunColor });
          for (const light of layer.lights) light.useHostLighting();
          const unsupported = simulation.diagnostics.entries.filter(entry => entry.kind.startsWith('unsupported-'));
          if (unsupported.length) {
            failures.push({ system: entity.system, reason: unsupported });
            layer.dispose();
            continue;
          }
          const defaults = new ControlPointDefaults();
          simulation.addControlPointDefaults(defaults);
          layer.addControlPointDefaults?.(defaults);
          for (const [index, value] of defaults.values) simulation.getControlPoint(index).position = value;
          placeMapParticle(simulation, entity);
          simulation.start();
          group.add(layer.object3d);
          state.systems.push({ entity, simulation, layer });
        } catch (reason) { failures.push({ system: entity.system, reason: String(reason) }); }
      }
      group.userData.failures = failures;
      group.userData.bundleDiagnostics = bundle.diagnostics;
      group.userData.ready = true;
    }).catch(error => { if (!cancelled) { group.userData.failures = [String(error)]; group.userData.ready = true; } });
    return () => {
      cancelled = true;
      lights.update([]);
      parent.remove(group);
      const state = current.current;
      if (state) {
        for (const { simulation, layer } of state.systems) { simulation.stop(); layer.dispose(); }
        state.textures.dispose(); state.depth?.dispose(); state.color?.dispose();
      }
      current.current = null;
    };
  }, [info, parent, lights]);
  const inverse = useRef(new THREE.Matrix4()), camera = useRef(new THREE.Vector3()), viewport = useRef(new THREE.Vector2());
  const frustum = useRef(new THREE.Frustum()), projection = useRef(new THREE.Matrix4()), bounds = useRef(new THREE.Box3());
  useFrame((three, delta) => {
    const state = current.current;
    if (!state || !state.group.visible || !active) {
      lights.update([]);
      return;
    }
    const started = performance.now();
    state.group.updateWorldMatrix(true, true);
    inverse.current.copy(state.group.matrixWorld).invert();
    three.camera.getWorldPosition(camera.current).applyMatrix4(inverse.current);
    const position = new Vector3(camera.current.x, camera.current.y, camera.current.z);
    const step = Math.min(Math.max(delta, 0), 0.1);
    state.time += step;
    frustum.current.setFromProjectionMatrix(projection.current.multiplyMatrices(three.camera.projectionMatrix, three.camera.matrixWorldInverse));
    for (const { simulation, layer } of state.systems) {
      simulation.setCameraPosition(position); simulation.update(step, state.time);
      const box = simulation.worldBoundingBox;
      // A light outside the view can still illuminate visible room geometry.
      if (box && !layer.emitsLight) {
        bounds.current.min.set(box.min.x, box.min.y, box.min.z);
        bounds.current.max.set(box.max.x, box.max.y, box.max.z);
        bounds.current.applyMatrix4(state.group.matrixWorld);
        // eslint-disable-next-line react-hooks/immutability -- R3F owns these mutable scene objects.
        layer.object3d.visible = frustum.current.intersectsBox(bounds.current);
      }
    }
    three.gl.getDrawingBufferSize(viewport.current);
    const size: [number, number] = [viewport.current.x, viewport.current.y];
    // Optional feathering uses normal depth testing. Required feathering gets a scene depth pass.
    const depth = state.systems.some(item => item.layer.object3d.visible && item.layer.requiresSceneDepth)
      ? (state.depth ??= new SceneDepthPass()).render(three.gl, three.scene, three.camera, size, state.group) : null;
    const color = state.systems.some(item => item.layer.object3d.visible && item.layer.wantsSceneColor)
      ? (state.color ??= new SceneColorPass()).render(three.gl, three.scene, three.camera, size, state.group) : null;
    for (const { layer } of state.systems) {
      if (!layer.object3d.visible) continue;
      layer.setScene(depth, color); layer.update(three.camera, size, state.time);
    }
    const lightStates = state.systems.flatMap(({ layer }) => layer.lights.flatMap(light => light.lightStates));
    lights.update(lightStates);
    const sourceFromViewer: unknown = three.scene.userData.source2SourceFromViewer;
    if (sourceFromViewer instanceof THREE.Matrix4) lights.renderShadows(three.gl, three.scene, sourceFromViewer);
    if (import.meta.env.DEV || import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') {
      state.group.userData.cpuMs = performance.now() - started;
      state.group.userData.systems = state.systems.map(({ entity, simulation }) => ({ id: entity.id, system: entity.system,
        particles: simulation.currentParticles.length, diagnostics: simulation.diagnostics.entries }));
      state.group.userData.lights = lightStates.map(light => ({ position: light.position.toArray(), range: light.range, cookie: light.cookie,
        brightness: light.linearBrightness * light.brightnessScale, shadows: light.castShadows }));
    }
  });
  return null;
}
