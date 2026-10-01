/** Bounded ambient preview using authored sprite attributes and shared rope
 * layers. Unsupported model renderers and operator classes remain omitted. */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { ADDITIVE_OVERLAY_RENDER_ORDER } from '../../lib/source2Preview/types';
import { advanceSpriteEmission, ageCurveValue, allSpriteLayers, fxTexturePngName, normalizedWindow, remapSpriteNormal, spriteFadeValue, spriteGradientColor, spriteInitialColor,
  type FxDescriptor, type SpriteEmissionState, type SpriteSimParams } from './fxDescriptor';
import { resolveParticleAttachment } from './particleAttachment';
import { spritecardMaterial } from './spritecardMaterial';
import { ParticleRopes } from './ParticleRopes';
import { bindParticleSnapshot, skinnedSnapshotPosition } from './particleSnapshotSkinning';
import { balanceSpritePreviewComposition } from './spritePreviewComposition';

const VERT = /* glsl */ `
  attribute vec3 aPosition;
  attribute float aRadius;
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aRotation;
  attribute vec4 aRegion;
  attribute float aFrameClamp;
  attribute vec3 aRight;
  attribute vec3 aUp;
  uniform float uAlignNormal;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vCardUv;
  varying vec4 vFrameRegion;
  varying float vFrameClamp;
  void main() {
    vUv = mix(aRegion.xy, aRegion.zw, uv);
    vCardUv = uv;
    vFrameRegion = aRegion;
    vFrameClamp = aFrameClamp;
    vColor = aColor;
    vAlpha = aAlpha;
    float c = cos(aRotation), s = sin(aRotation);
    vec2 corner = mat2(c, -s, s, c) * position.xy;
    vec4 viewPosition = modelViewMatrix * vec4(aPosition, 1.0);
    float modelScale = length(modelMatrix[0].xyz);
    if (uAlignNormal > 0.5) viewPosition += modelViewMatrix * vec4((aRight * corner.x + aUp * corner.y) * aRadius, 0.0);
    else viewPosition.xy += corner * aRadius * modelScale;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasMap;
  uniform float uAdditive;
  uniform float uAlphaOnly;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(vUv - vec2(0.5));
    vec4 tex = uHasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, 1.0 - smoothstep(0.0, 0.5, d));
    if (uAlphaOnly > 0.5) tex.rgb = vec3(1.0);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (uAdditive > 0.5) {
      // Black adds no radiance. It must also add no canvas coverage, otherwise
      // opaque-black sprite borders hide the viewer background and PNG alpha.
      // Preserve the authored RGB contribution under SrcAlpha/One blending.
      float coverage = clamp(max(max(tex.r, tex.g), tex.b), 0.0, 1.0);
      gl_FragColor.a *= coverage;
      gl_FragColor.rgb /= max(coverage, 0.0001);
    }
    if (gl_FragColor.a <= 0.001) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
interface Particle {
  age: number; life: number; position: THREE.Vector3;
  velocity: THREE.Vector3; radius: number; rotation: number; spin: number;
  color: THREE.Color; alpha: number;
  region: [number, number, number, number];
  frameClamp: boolean;
  snapshotIndex: number | null;
  normal: THREE.Vector3; normalAxis: THREE.Vector3; normalRate: number;
  oscillation: { rate: THREE.Vector3; frequency: THREE.Vector3; start: number; end: number } | null;
}
const sample = (range: [number, number]) => THREE.MathUtils.lerp(range[0], range[1], Math.random());
interface SpawnEvent { id: number; time: number; position: THREE.Vector3 }
class SpawnEvents {
  private nextId = 0;
  private systems = new Map<string, SpawnEvent[]>();
  read(system: string): readonly SpawnEvent[] { return this.systems.get(system) ?? []; }
  publish(system: string, time: number, position: THREE.Vector3) {
    const events = this.systems.get(system) ?? [];
    events.push({ id: ++this.nextId, time, position: position.clone() });
    // Consumers run later in the same frame. Bound history across renderers.
    if (events.length > 256) events.splice(0, events.length - 256);
    this.systems.set(system, events);
  }
}

function SpriteLayer({ layer, textureBaseUrl, model, playback, spawnEvents }: {
  layer: SpriteSimParams; textureBaseUrl: string; model?: THREE.Object3D;
  playback?: { paused: boolean; speed: number };
  spawnEvents: RefObject<SpawnEvents>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const particles = useRef<Particle[]>([]);
  const emissionState = useRef<SpriteEmissionState[]>([]);
  const clock = useRef(0);
  const initialized = useRef(false);
  const particleNumber = useRef(0);
  const lastParentEvent = useRef(0);
  const texture = useMemo(() => {
    if (!layer.texture) return null;
    const tex = new THREE.TextureLoader().load(textureBaseUrl + fxTexturePngName(layer.texture));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [layer.texture, textureBaseUrl]);
  const attachment = useMemo(() => model ? resolveParticleAttachment(model, layer.attachment, layer.attachments) : null, [model, layer.attachment, layer.attachments]);
  const anchor = attachment?.object;
  const snapshot = useMemo(() => model && layer.snapshot ? bindParticleSnapshot(model, layer.snapshot.points) : null, [model, layer.snapshot]);
  const beforeTransmission = useMemo(() => {
    let glass = false;
    model?.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (((m as THREE.MeshPhysicalMaterial | undefined)?.transmission ?? 0) > 0) glass = true;
      }
    });
    return layer.additive && glass;
  }, [model, layer.additive]);
  const spritecard = useMemo(() => {
    const renderer = layer.spritecard;
    if (!renderer || !Array.isArray(renderer.params.m_vecTexturesInput)
      || renderer.params.m_vecTexturesInput.length < 2) return null;
    const result = spritecardMaterial(renderer, textureBaseUrl, VERT, true, true);
    if (result) {
      result.material.uniforms.uAlignNormal = { value: layer.alignNormal ? 1 : 0 };
      result.material.transparent = !beforeTransmission;
    }
    return result;
  }, [layer.spritecard, layer.alignNormal, textureBaseUrl, beforeTransmission]);
  const attachmentRotation = useMemo(() => attachment?.frame ? new THREE.Quaternion(...attachment.frame.rotation) : null, [attachment]);
  // morphic converts Source inches to meters at the skeleton root. The effect
  // sits alongside that root, so apply the same units exactly once.
  const sourceUnit = useMemo(() => (model?.getObjectByName('skeleton')?.scale.x ?? 0.0254) * layer.scale, [model, layer.scale]);
  const sourceRoot = useMemo(() => model?.getObjectByName('skeleton') ?? null, [model]);
  const scratch = useMemo(() => ({
    snapshotScratch: new THREE.Vector3(), origin: new THREE.Vector3(), previous: new THREE.Vector3(),
    orientation: new THREE.Quaternion(), parentOrientation: new THREE.Quaternion(),
    sourceOrientation: new THREE.Quaternion(), gravity: new THREE.Vector3(),
    previousOrientation: new THREE.Quaternion(), deltaOrientation: new THREE.Quaternion(),
    orbitAxis: new THREE.Vector3(), orbitRotation: new THREE.Quaternion(),
    normalSource: new THREE.Vector3(), normalRight: new THREE.Vector3(), normalUp: new THREE.Vector3(), normalReference: new THREE.Vector3(),
    color: new THREE.Color(), fadeColor: layer.colorFade ? new THREE.Color().setRGB(...layer.colorFade) : null,
  }), [layer.colorFade]);
  const { geometry, material } = useMemo(() => {
    const quad = new THREE.PlaneGeometry(2, 2);
    const geom = new THREE.InstancedBufferGeometry();
    geom.setIndex(quad.index);
    geom.setAttribute('position', quad.getAttribute('position'));
    geom.setAttribute('uv', quad.getAttribute('uv'));
    for (const [name, size] of [['aPosition', 3], ['aColor', 3], ['aRadius', 1], ['aAlpha', 1], ['aRotation', 1], ['aRegion', 4], ['aFrameClamp', 1], ['aRight', 3], ['aUp', 3]] as const) {
      geom.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(layer.maxParticles * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    geom.instanceCount = 0;
    quad.dispose();
    const glow = layer.additive || (typeof layer.spritecard?.params.m_flSelfIllumAmount === 'number' && layer.spritecard.params.m_flSelfIllumAmount > 0);
    return { geometry: geom, material: spritecard?.material ?? new THREE.ShaderMaterial({
      userData: { previewBloom: glow },
      uniforms: { map: { value: texture }, uHasMap: { value: texture ? 1 : 0 }, uAdditive: { value: layer.additive ? 1 : 0 }, uAlignNormal: { value: layer.alignNormal ? 1 : 0 }, uAlphaOnly: { value: layer.alphaOnly ? 1 : 0 } },
      // Three's transmission target includes only the opaque queue. Custom
      // additive blending still works there, after bodies and before glass, so
      // embedded sprites become transmitted scene radiance rather than failing
      // the glass depth test later. Models without glass retain the usual queue.
      vertexShader: VERT, fragmentShader: FRAG, transparent: !beforeTransmission, depthWrite: false, side: THREE.DoubleSide,
      blending: layer.additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    }) };
  }, [layer.maxParticles, layer.additive, layer.alignNormal, layer.alphaOnly, layer.spritecard, texture, beforeTransmission, spritecard]);
  useEffect(() => () => { texture?.dispose(); }, [texture]);
  useEffect(() => () => { spritecard?.textures.forEach((t) => t.dispose()); }, [spritecard]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useEffect(() => {
    particles.current = []; emissionState.current = []; clock.current = 0; initialized.current = false; particleNumber.current = 0; lastParentEvent.current = 0;
    if (meshRef.current) (meshRef.current.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
  }, [layer, geometry]);

  useFrame((_, deltaRaw) => {
    if (playback?.paused) return;
    const speed = playback?.speed ?? 1;
    const delta = Number.isFinite(deltaRaw) && Number.isFinite(speed) ? Math.max(0, Math.min(deltaRaw * speed, 0.1)) : 0;
    if (delta <= 0) return;
    spritecard?.update(clock.current);
    const mesh = meshRef.current;
    if (!mesh?.parent) return;
    const { origin, previous, orientation, parentOrientation, sourceOrientation, gravity } = scratch;
    mesh.parent.getWorldQuaternion(parentOrientation).invert();
    if (sourceRoot) {
      sourceRoot.updateWorldMatrix(true, false);
      sourceRoot.getWorldQuaternion(sourceOrientation).premultiply(parentOrientation);
    } else {
      // Source Z-up to morphic Y-up. With an exported skeleton its root owns
      // this conversion; local attachment vectors use the bone basis directly.
      sourceOrientation.set(0.5, 0.5, 0.5, 0.5).invert();
    }
    gravity.set(...layer.gravity).multiplyScalar(sourceUnit).applyQuaternion(sourceOrientation);
    orientation.copy(sourceOrientation);
    origin.set(0, 0, 0);
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      if (attachment?.frame) anchor.localToWorld(origin.set(...attachment.frame.position));
      else anchor.getWorldPosition(origin);
      mesh.parent.worldToLocal(origin);
      anchor.getWorldQuaternion(orientation);
      if (attachmentRotation) orientation.multiply(attachmentRotation);
      orientation.premultiply(parentOrientation);
    }
    if (!initialized.current) { previous.copy(origin); scratch.previousOrientation.copy(orientation); initialized.current = true; }
    const list = particles.current;
    if (layer.follow) {
      scratch.deltaOrientation.copy(scratch.previousOrientation).invert().premultiply(orientation);
      for (const p of list) {
        if (layer.followRotation) {
          p.position.sub(previous).applyQuaternion(scratch.deltaOrientation).add(origin);
          p.velocity.applyQuaternion(scratch.deltaOrientation);
        }
        else p.position.add(origin).sub(previous);
      }
    }
    // Remove spent slots before emission, and account only for the part of a
    // frame after birth. Pausing freezes this clock and delayed emitters too.
    const live = list.filter((p) => layer.persistent || p.age + delta < p.life);
    particles.current = live;
    const capacity = layer.maxParticles - live.length;
    const births: Array<{ age: number; parentPosition?: THREE.Vector3 }> = advanceSpriteEmission(
      layer.emissions, emissionState.current, clock.current, clock.current + delta, capacity).map((age) => ({ age }));
    if (layer.parentSpawnEvents && layer.parentSystemId) {
      const events = spawnEvents.current.read(layer.parentSystemId);
      const window = layer.parentSpawnWindow;
      let emitted = 0;
      for (const event of events) {
        if (event.id <= lastParentEvent.current) continue;
        // Consume even when full: a dropped event must not become a later burst.
        lastParentEvent.current = event.id;
        if (births.length < capacity && emitted < (window?.perFrame ?? 256)
          && event.time >= (window?.start ?? 0)
          && (!window?.duration || event.time < window.start + window.duration)
          && event.time >= clock.current && event.time <= clock.current + delta) {
          births.push({ age: clock.current + delta - event.time, parentPosition: event.position });
          emitted++;
        }
      }
    }
    clock.current += delta;
    for (const birth of births) {
      const birthAge = birth.age;
      const lo = Math.min(...layer.sequence), hi = Math.max(...layer.sequence);
      const id = lo + Math.min(hi - lo, Math.floor(Math.random() * (hi - lo + 1)));
      const frame = layer.sheet?.sequences.find((s) => s.id === id);
      if (layer.sheet && !frame) continue;
      // Region bounds are authored texel centers. Flip the top-down sheet once,
      // matching TextureLoader's image upload, and never sample adjacent cells.
      const region: Particle['region'] = frame
        ? [frame.uv[0], 1-frame.uv[3], frame.uv[2], 1-frame.uv[1]] : [0, 0, 1, 1];
      const z = Math.random()*2 - 1, angle = Math.random()*Math.PI*2;
      const direction = new THREE.Vector3(Math.sqrt(1-z*z)*Math.cos(angle), Math.sqrt(1-z*z)*Math.sin(angle), z);
      const distance = THREE.MathUtils.lerp(Math.min(layer.spawnRadiusMin, layer.spawnRadius), Math.max(layer.spawnRadiusMin, layer.spawnRadius), Math.cbrt(Math.random()));
      // Authored local boxes are sampled in the CP frame. Keeping the planar
      // axes intact matters for book glows; a sphere collapses their silhouette.
      const offset = layer.spawnBox ? new THREE.Vector3(
        THREE.MathUtils.lerp(layer.spawnBox.min[0], layer.spawnBox.max[0], Math.random()),
        THREE.MathUtils.lerp(layer.spawnBox.min[1], layer.spawnBox.max[1], Math.random()),
        THREE.MathUtils.lerp(layer.spawnBox.min[2], layer.spawnBox.max[2], Math.random())
      ).multiplyScalar(sourceUnit).applyQuaternion(layer.spawnLocal ? orientation : sourceOrientation)
        : direction.clone().multiply(new THREE.Vector3(...layer.spawnBias)).multiplyScalar(distance*sourceUnit).applyQuaternion(layer.spawnLocal ? orientation : sourceOrientation);
      if (layer.ring) {
        const ringAngle = Math.random()*Math.PI*2;
        offset.copy(direction).multiplyScalar(Math.cbrt(Math.random())*sample(layer.ring.thickness))
          .add(new THREE.Vector3(Math.cos(ringAngle), Math.sin(ringAngle), 0).multiplyScalar(sample(layer.ring.radius)))
          .multiplyScalar(sourceUnit).applyQuaternion(orientation);
      }
      const input = layer.radiusInput as { pf?: string; biasType?: string; bias?: number } | undefined;
      let radiusRandom = Math.random();
      if (input?.pf === 'PF_TYPE_RANDOM_BIASED' && input.biasType === 'PF_BIAS_TYPE_EXPONENTIAL') {
        const bias = THREE.MathUtils.clamp(input.bias ?? 0, -1, 1);
        radiusRandom = Math.pow(radiusRandom, bias < 0 ? 1 - 19*bias : 1-bias);
      }
      const radius = THREE.MathUtils.lerp(...layer.radius, radiusRandom)*sourceUnit;
      for (const positionOffset of layer.offsets) {
        offset.add(new THREE.Vector3(
          THREE.MathUtils.lerp(positionOffset.min[0], positionOffset.max[0], Math.random()),
          THREE.MathUtils.lerp(positionOffset.min[1], positionOffset.max[1], Math.random()),
          THREE.MathUtils.lerp(positionOffset.min[2], positionOffset.max[2], Math.random())
        ).multiplyScalar(positionOffset.proportional ? radius : sourceUnit).applyQuaternion(positionOffset.local ? orientation : sourceOrientation));
      }
      const velocity = direction.multiplyScalar(sample(layer.speed)*sourceUnit).applyQuaternion(layer.spawnLocal ? orientation : sourceOrientation)
        .add(new THREE.Vector3(
          THREE.MathUtils.lerp(layer.localSpeedMin[0], layer.localSpeedMax[0], Math.random()),
          THREE.MathUtils.lerp(layer.localSpeedMin[1], layer.localSpeedMax[1], Math.random()),
          THREE.MathUtils.lerp(layer.localSpeedMin[2], layer.localSpeedMax[2], Math.random())
        ).multiplyScalar(sourceUnit).applyQuaternion(orientation));
      const tint = new THREE.Color().setRGB(...layer.colorMin).lerp(new THREE.Color().setRGB(...layer.colorMax), Math.random());
      const initialColor = spriteInitialColor(layer.colorInitializers, particleNumber.current++);
      if (initialColor) tint.setRGB(...initialColor);
      const normalDelta = offset.clone().applyQuaternion(sourceOrientation.clone().invert());
      const normal = layer.normal ? new THREE.Vector3(...remapSpriteNormal(normalDelta.toArray() as [number, number, number], layer.normal.axis, layer.normal.angle, layer.normal.normalize)) : new THREE.Vector3(0, 0, 1);
      const normalRandom = Math.random();
      const normalAxis = layer.normalRotation ? new THREE.Vector3(...layer.normalRotation.axisMin.map((lo, i) => THREE.MathUtils.lerp(lo, layer.normalRotation!.axisMax[i], normalRandom))).normalize() : new THREE.Vector3(0, 0, 1);
      const spawnPosition = offset.add(layer.spawnAtParent && birth.parentPosition ? birth.parentPosition : origin);
      const snapshotIndex = snapshot?.length ? layer.snapshot?.random
        ? Math.min(snapshot.length-1, Math.floor(Math.random()*snapshot.length)) : (particleNumber.current-1)%snapshot.length : null;
      if (snapshotIndex !== null && snapshot) {
        skinnedSnapshotPosition(snapshot[snapshotIndex], spawnPosition, scratch.snapshotScratch);
        mesh.parent.worldToLocal(spawnPosition);
      }
      if (layer.publishesSpawnEvents && layer.systemId) {
        spawnEvents.current.publish(layer.systemId, clock.current - birthAge, spawnPosition);
      }
      live.push({ age: birthAge-delta, life: sample(layer.lifetime),
        position: spawnPosition, velocity, snapshotIndex,
        radius, rotation: sample(layer.rotation), spin: sample(layer.spin), color: tint, alpha: sample(layer.alpha), region, frameClamp: frame?.clamp === true,
        normal, normalAxis, normalRate: layer.normalRotation ? THREE.MathUtils.lerp(...layer.normalRotation.rate, normalRandom) : 0,
        oscillation: layer.oscillation ? {
          rate: new THREE.Vector3(...layer.oscillation.rateMin.map((lo, i) => THREE.MathUtils.lerp(lo, layer.oscillation!.rateMax[i], Math.random()))),
          frequency: new THREE.Vector3(...layer.oscillation.frequencyMin.map((lo, i) => THREE.MathUtils.lerp(lo, layer.oscillation!.frequencyMax[i], Math.random()))),
          start: sample(layer.oscillation.start), end: sample(layer.oscillation.end),
        } : null });
    }
    const position = geometry.getAttribute('aPosition') as THREE.InstancedBufferAttribute;
    const color = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const radius = geometry.getAttribute('aRadius') as THREE.InstancedBufferAttribute;
    const alpha = geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    const rotation = geometry.getAttribute('aRotation') as THREE.InstancedBufferAttribute;
    const region = geometry.getAttribute('aRegion') as THREE.InstancedBufferAttribute;
    const frameClamp = geometry.getAttribute('aFrameClamp') as THREE.InstancedBufferAttribute;
    const right = geometry.getAttribute('aRight') as THREE.InstancedBufferAttribute;
    const up = geometry.getAttribute('aUp') as THREE.InstancedBufferAttribute;
    let count = 0;
    for (const p of live) {
      p.age += delta;
      if (!layer.persistent && p.age >= p.life) continue;
      const step = Math.min(delta, p.age);
      if (p.snapshotIndex !== null && snapshot) {
        skinnedSnapshotPosition(snapshot[p.snapshotIndex], p.position, scratch.snapshotScratch);
        mesh.parent.worldToLocal(p.position);
      }
      if (layer.movement) {
        // Source's drag is fractional velocity loss per 1/30 second. Gravity
        // adds after inertia decay, matching BasicMovement's position step.
        p.velocity.multiplyScalar(Math.pow(1-layer.drag, 30*step)).addScaledVector(gravity, step);
        p.position.addScaledVector(p.velocity, step);
      }
      if (layer.orbit) {
        // Source substitutes +Z when the authored axis's X is zero. Rotating
        // both position and velocity preserves physical momentum, so orbital
        // displacement does not become an extra outward velocity next frame.
        scratch.orbitAxis.fromArray(layer.orbit.axis[0] === 0 ? [0, 0, 1] : layer.orbit.axis).normalize()
          .applyQuaternion(layer.orbit.local ? orientation : sourceOrientation);
        scratch.orbitRotation.setFromAxisAngle(scratch.orbitAxis, layer.orbit.rate*step);
        p.position.sub(origin).applyQuaternion(scratch.orbitRotation).add(origin);
        p.velocity.applyQuaternion(scratch.orbitRotation);
      }
      p.rotation += (p.spin + layer.spinRate)*step;
      if (layer.normalRotation) p.normal.applyAxisAngle(p.normalAxis, p.normalRate*step).normalize();
      const t = p.age/p.life;
      if (layer.oscillation && p.oscillation) {
        const osc = layer.oscillation, state = p.oscillation;
        const age = osc.proportional ? t : p.age;
        if (age >= state.start && age < state.end) {
          // Source adds a sinusoidal velocity-like offset every step in world
          // axes. It does not replace the spawn position or rotate with the CP.
          p.position.add(new THREE.Vector3(
            state.rate.x*Math.sin(Math.PI*(age*state.frequency.x*osc.multiplier+osc.offset)),
            state.rate.y*Math.sin(Math.PI*(age*state.frequency.y*osc.multiplier+osc.offset)),
            state.rate.z*Math.sin(Math.PI*(age*state.frequency.z*osc.multiplier+osc.offset))
          ).multiplyScalar(sourceUnit*step*osc.scale).applyQuaternion(sourceOrientation));
        }
      }
      scratch.color.copy(p.color);
      const gradientColor = spriteGradientColor(layer.colorGradient, t);
      if (gradientColor) scratch.color.setRGB(...gradientColor);
      if (scratch.fadeColor) scratch.color.lerp(scratch.fadeColor, normalizedWindow(t, layer.colorFadeTime, layer.colorEase));
      position.setXYZ(count, p.position.x, p.position.y, p.position.z);
      color.setXYZ(count, scratch.color.r*(spritecard ? 1 : layer.overbright), scratch.color.g*(spritecard ? 1 : layer.overbright), scratch.color.b*(spritecard ? 1 : layer.overbright));
      radius.setX(count, Math.min(128*sourceUnit, p.radius*layer.radiusScale*Math.max(0, ageCurveValue(layer.radiusCurve, t))));
      alpha.setX(count, p.alpha*layer.alphaScale*spriteFadeValue(layer.fade, t)*THREE.MathUtils.clamp(ageCurveValue(layer.alphaCurve, t), 0, 1));
      scratch.normalSource.copy(p.normal).normalize();
      scratch.normalReference.fromArray(Math.abs(p.normal.z) > 0.1 ? [0, -1, 0] : [0, 0, 1]);
      scratch.normalUp.crossVectors(scratch.normalSource, scratch.normalReference).normalize();
      scratch.normalRight.crossVectors(scratch.normalUp, scratch.normalSource);
      scratch.normalUp.applyQuaternion(sourceOrientation); scratch.normalRight.applyQuaternion(sourceOrientation);
      right.setXYZ(count, scratch.normalRight.x, scratch.normalRight.y, scratch.normalRight.z);
      up.setXYZ(count, scratch.normalUp.x, scratch.normalUp.y, scratch.normalUp.z);
      rotation.setX(count, p.rotation);
      region.setXYZW(count, ...p.region);
      frameClamp.setX(count, p.frameClamp ? 1 : 0);
      live[count++] = p;
    }
    live.length = count;
    (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
    for (const attr of [position, color, radius, alpha, rotation, region, frameClamp, right, up]) attr.needsUpdate = true;
    previous.copy(origin);
    scratch.previousOrientation.copy(orientation);
  });
  if (layer.snapshot && !snapshot) return null;
  if (layer.attachment && !anchor && !snapshot) return null;
  return <mesh ref={meshRef} geometry={geometry} material={material}
    renderOrder={beforeTransmission ? ADDITIVE_OVERLAY_RENDER_ORDER : 0} frustumCulled={false} />;
}

export function ParticleEffect({ descriptor, textureBaseUrl, model, playback }: {
  descriptor: FxDescriptor; textureBaseUrl: string; model?: THREE.Object3D;
  playback?: { paused: boolean; speed: number };
}) {
  const layers = useMemo(() => balanceSpritePreviewComposition(allSpriteLayers(descriptor)), [descriptor]);
  const spawnEvents = useRef<SpawnEvents>(new SpawnEvents());
  useEffect(() => { spawnEvents.current = new SpawnEvents(); }, [descriptor]);
  return <group>{layers.map((layer, i) => <SpriteLayer key={i} layer={layer} textureBaseUrl={textureBaseUrl} model={model} playback={playback} spawnEvents={spawnEvents} />)}
    <ParticleRopes descriptor={descriptor} model={model} textureBaseUrl={textureBaseUrl} playback={playback} /></group>;
}
