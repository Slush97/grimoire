/** Bounded sprite preview using authored rates and attributes. This intentionally
 * skips Source 2 rope/model renderers and unimplemented operator classes. */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { advanceSpriteEmission, ageCurveValue, allSpriteLayers, fxTexturePngName, normalizedWindow, spriteFadeValue,
  type FxDescriptor, type SpriteEmissionState, type SpriteSimParams } from './fxDescriptor';
import { resolveParticleAttachment } from './particleAttachment';

const VERT = /* glsl */ `
  attribute vec3 aPosition;
  attribute float aRadius;
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aRotation;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vColor = aColor;
    vAlpha = aAlpha;
    float c = cos(aRotation), s = sin(aRotation);
    vec2 corner = mat2(c, -s, s, c) * position.xy;
    vec4 viewPosition = modelViewMatrix * vec4(aPosition, 1.0);
    float modelScale = length(modelMatrix[0].xyz);
    viewPosition.xy += corner * aRadius * modelScale;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasMap;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(vUv - vec2(0.5));
    vec4 tex = uHasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, 1.0 - smoothstep(0.0, 0.5, d));
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
}
const sample = (range: [number, number]) => THREE.MathUtils.lerp(range[0], range[1], Math.random());

function SpriteLayer({ layer, textureBaseUrl, model, playback }: {
  layer: SpriteSimParams; textureBaseUrl: string; model?: THREE.Object3D;
  playback?: { paused: boolean; speed: number };
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const particles = useRef<Particle[]>([]);
  const emissionState = useRef<SpriteEmissionState[]>([]);
  const clock = useRef(0);
  const initialized = useRef(false);
  const texture = useMemo(() => {
    if (!layer.texture) return null;
    const tex = new THREE.TextureLoader().load(textureBaseUrl + fxTexturePngName(layer.texture));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [layer.texture, textureBaseUrl]);
  const attachment = useMemo(() => model ? resolveParticleAttachment(model, layer.attachment) : null, [model, layer.attachment]);
  const anchor = attachment?.object;
  const attachmentRotation = useMemo(() => attachment?.frame ? new THREE.Quaternion(...attachment.frame.rotation) : null, [attachment]);
  // morphic converts Source inches to meters at the skeleton root. The effect
  // sits alongside that root, so apply the same units exactly once.
  const sourceUnit = useMemo(() => model?.getObjectByName('skeleton')?.scale.x ?? 0.0254, [model]);
  const sourceRoot = useMemo(() => model?.getObjectByName('skeleton') ?? null, [model]);
  const scratch = useMemo(() => ({
    origin: new THREE.Vector3(), previous: new THREE.Vector3(),
    orientation: new THREE.Quaternion(), parentOrientation: new THREE.Quaternion(),
    sourceOrientation: new THREE.Quaternion(), gravity: new THREE.Vector3(),
    previousOrientation: new THREE.Quaternion(), deltaOrientation: new THREE.Quaternion(),
    orbitAxis: new THREE.Vector3(), orbitRotation: new THREE.Quaternion(),
    color: new THREE.Color(), fadeColor: layer.colorFade ? new THREE.Color().setRGB(...layer.colorFade) : null,
  }), [layer.colorFade]);
  const { geometry, material } = useMemo(() => {
    const quad = new THREE.PlaneGeometry(2, 2);
    const geom = new THREE.InstancedBufferGeometry();
    geom.setIndex(quad.index);
    geom.setAttribute('position', quad.getAttribute('position'));
    geom.setAttribute('uv', quad.getAttribute('uv'));
    for (const [name, size] of [['aPosition', 3], ['aColor', 3], ['aRadius', 1], ['aAlpha', 1], ['aRotation', 1]] as const) {
      geom.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(layer.maxParticles * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    geom.instanceCount = 0;
    quad.dispose();
    return { geometry: geom, material: new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uHasMap: { value: texture ? 1 : 0 }, uAdditive: { value: layer.additive ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: layer.additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    }) };
  }, [layer.maxParticles, layer.additive, texture]);
  useEffect(() => () => { texture?.dispose(); }, [texture]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useEffect(() => {
    particles.current = []; emissionState.current = []; clock.current = 0; initialized.current = false;
    if (meshRef.current) (meshRef.current.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
  }, [layer, geometry]);

  useFrame((_, deltaRaw) => {
    if (playback?.paused) return;
    const speed = playback?.speed ?? 1;
    const delta = Number.isFinite(deltaRaw) && Number.isFinite(speed) ? Math.max(0, Math.min(deltaRaw * speed, 0.1)) : 0;
    if (delta <= 0) return;
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
    const live = list.filter((p) => p.age + delta < p.life);
    particles.current = live;
    const births = advanceSpriteEmission(layer.emissions, emissionState.current, clock.current, clock.current + delta, layer.maxParticles - live.length);
    clock.current += delta;
    for (const birthAge of births) {
      const z = Math.random()*2 - 1, angle = Math.random()*Math.PI*2;
      const direction = new THREE.Vector3(Math.sqrt(1-z*z)*Math.cos(angle), Math.sqrt(1-z*z)*Math.sin(angle), z);
      const distance = THREE.MathUtils.lerp(Math.min(layer.spawnRadiusMin, layer.spawnRadius), Math.max(layer.spawnRadiusMin, layer.spawnRadius), Math.cbrt(Math.random()));
      const offset = direction.clone().multiplyScalar(distance*sourceUnit).applyQuaternion(layer.spawnLocal ? orientation : sourceOrientation);
      const radius = sample(layer.radius)*sourceUnit;
      const positionOffset = new THREE.Vector3(
        THREE.MathUtils.lerp(layer.offsetMin[0], layer.offsetMax[0], Math.random()),
        THREE.MathUtils.lerp(layer.offsetMin[1], layer.offsetMax[1], Math.random()),
        THREE.MathUtils.lerp(layer.offsetMin[2], layer.offsetMax[2], Math.random())
      ).multiplyScalar(layer.offsetProportional ? radius : sourceUnit).applyQuaternion(layer.offsetLocal ? orientation : sourceOrientation);
      offset.add(positionOffset);
      const velocity = direction.multiplyScalar(sample(layer.speed)*sourceUnit).applyQuaternion(layer.spawnLocal ? orientation : sourceOrientation)
        .add(new THREE.Vector3(
          THREE.MathUtils.lerp(layer.localSpeedMin[0], layer.localSpeedMax[0], Math.random()),
          THREE.MathUtils.lerp(layer.localSpeedMin[1], layer.localSpeedMax[1], Math.random()),
          THREE.MathUtils.lerp(layer.localSpeedMin[2], layer.localSpeedMax[2], Math.random())
        ).multiplyScalar(sourceUnit).applyQuaternion(orientation));
      const tint = new THREE.Color().setRGB(...layer.colorMin).lerp(new THREE.Color().setRGB(...layer.colorMax), Math.random());
      live.push({ age: birthAge-delta, life: sample(layer.lifetime),
        position: offset.add(origin), velocity,
        radius, rotation: sample(layer.rotation), spin: sample(layer.spin), color: tint, alpha: sample(layer.alpha) });
    }
    const position = geometry.getAttribute('aPosition') as THREE.InstancedBufferAttribute;
    const color = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const radius = geometry.getAttribute('aRadius') as THREE.InstancedBufferAttribute;
    const alpha = geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    const rotation = geometry.getAttribute('aRotation') as THREE.InstancedBufferAttribute;
    let count = 0;
    for (const p of live) {
      p.age += delta;
      if (p.age >= p.life) continue;
      const step = Math.min(delta, p.age);
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
      p.rotation += p.spin*step;
      const t = p.age/p.life;
      scratch.color.copy(p.color);
      if (scratch.fadeColor) scratch.color.lerp(scratch.fadeColor, normalizedWindow(t, layer.colorFadeTime, layer.colorEase));
      position.setXYZ(count, p.position.x, p.position.y, p.position.z);
      color.setXYZ(count, scratch.color.r*layer.overbright, scratch.color.g*layer.overbright, scratch.color.b*layer.overbright);
      radius.setX(count, Math.min(128*sourceUnit, p.radius*Math.max(0, ageCurveValue(layer.radiusCurve, t))));
      alpha.setX(count, p.alpha*spriteFadeValue(layer.fade, t)*THREE.MathUtils.clamp(ageCurveValue(layer.alphaCurve, t), 0, 1));
      rotation.setX(count, p.rotation);
      live[count++] = p;
    }
    live.length = count;
    (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
    for (const attr of [position, color, radius, alpha, rotation]) attr.needsUpdate = true;
    previous.copy(origin);
    scratch.previousOrientation.copy(orientation);
  });
  if (layer.attachment && !anchor) return null;
  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}

export function ParticleEffect({ descriptor, textureBaseUrl, model, playback }: {
  descriptor: FxDescriptor; textureBaseUrl: string; model?: THREE.Object3D;
  playback?: { paused: boolean; speed: number };
}) {
  const layers = useMemo(() => allSpriteLayers(descriptor), [descriptor]);
  return <group>{layers.map((layer, i) => <SpriteLayer key={i} layer={layer} textureBaseUrl={textureBaseUrl} model={model} playback={playback} />)}</group>;
}
