/** Bounded sprite preview using authored rates and attributes. This intentionally
 * skips Source 2 rope/model renderers and unimplemented operator classes. */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ageCurveValue, allSpriteLayers, fxTexturePngName, type FxDescriptor, type SpriteSimParams } from './fxDescriptor';

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
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(vUv - vec2(0.5));
    vec4 tex = uHasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, 1.0 - smoothstep(0.0, 0.5, d));
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (gl_FragColor.a <= 0.001) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
interface Particle {
  age: number; life: number; position: THREE.Vector3; offset: THREE.Vector3;
  velocity: THREE.Vector3; radius: number; rotation: number; spin: number;
  color: THREE.Color; alpha: number;
}
const sample = (range: [number, number]) => THREE.MathUtils.lerp(range[0], range[1], Math.random());

/** Named attachments are not currently exported as nodes. Fall back to the
 * corresponding hand bone for ability_cast while preserving exact matches. */
function particleAnchor(model: THREE.Object3D, attachment: string | null): THREE.Object3D | null {
  if (attachment) {
    const exact = model.getObjectByName(attachment);
    if (exact) return exact;
  }
  const side = /left|_l$/i.test(attachment ?? '') ? 'l' : 'r';
  let found: THREE.Object3D | null = null;
  model.traverse((object) => {
    if (found) return;
    const name = object.name.toLowerCase();
    if (attachment && /cast|hand/i.test(attachment)
      && [ `hand_${side}`, `${side}_hand`, `bip_hand_${side}` ].includes(name)) found = object;
    if (!attachment && /^(spine_?2|spine_?1|bip_spine_?2)$/.test(name)) found = object;
  });
  return found;
}

function SpriteLayer({ layer, textureBaseUrl, model, playback }: {
  layer: SpriteSimParams; textureBaseUrl: string; model?: THREE.Object3D;
  playback?: { paused: boolean; speed: number };
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const particles = useRef<Particle[]>([]);
  const spawnAcc = useRef(layer.emitFirst ? 1 : 0);
  const initialized = useRef(false);
  const texture = useMemo(() => {
    if (!layer.texture) return null;
    const tex = new THREE.TextureLoader().load(textureBaseUrl + fxTexturePngName(layer.texture));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [layer.texture, textureBaseUrl]);
  const anchor = useMemo(() => model ? particleAnchor(model, layer.attachment) : null, [model, layer.attachment]);
  // morphic converts Source inches to meters at the skeleton root. The effect
  // sits alongside that root, so apply the same units exactly once.
  const sourceUnit = useMemo(() => model?.getObjectByName('skeleton')?.scale.x ?? 0.0254, [model]);
  const scratch = useMemo(() => ({
    origin: new THREE.Vector3(), previous: new THREE.Vector3(),
    orientation: new THREE.Quaternion(), parentOrientation: new THREE.Quaternion(),
    gravity: new THREE.Vector3(layer.gravity[1], layer.gravity[2], layer.gravity[0]).multiplyScalar(sourceUnit),
    color: new THREE.Color(),
  }), [layer.gravity, sourceUnit]);
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
      uniforms: { map: { value: texture }, uHasMap: { value: texture ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: layer.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }) };
  }, [layer.maxParticles, layer.additive, texture]);
  useEffect(() => () => { texture?.dispose(); geometry.dispose(); material.dispose(); }, [texture, geometry, material]);

  useFrame((_, deltaRaw) => {
    if (playback?.paused) return;
    const delta = Math.min(deltaRaw, 0.05) * (playback?.speed ?? 1);
    const mesh = meshRef.current;
    if (!mesh?.parent) return;
    const { origin, previous, orientation, parentOrientation, gravity } = scratch;
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      anchor.getWorldPosition(origin);
      mesh.parent.worldToLocal(origin);
      anchor.getWorldQuaternion(orientation);
      mesh.parent.getWorldQuaternion(parentOrientation).invert();
      orientation.premultiply(parentOrientation);
    }
    if (!initialized.current) { previous.copy(origin); initialized.current = true; }
    const list = particles.current;
    if (layer.follow) for (const p of list) p.position.add(origin).sub(previous);
    spawnAcc.current = Math.min(layer.maxParticles, spawnAcc.current + layer.emitRate * delta);
    while (spawnAcc.current >= 1 && list.length < layer.maxParticles) {
      spawnAcc.current -= 1;
      const offset = new THREE.Vector3(Math.random()*2 - 1, Math.random()*2 - 1, Math.random()*2 - 1).normalize()
        .multiplyScalar(Math.cbrt(Math.random()) * layer.spawnRadius);
      offset.add(new THREE.Vector3(
        THREE.MathUtils.lerp(layer.offsetMin[0], layer.offsetMax[0], Math.random()),
        THREE.MathUtils.lerp(layer.offsetMin[1], layer.offsetMax[1], Math.random()),
        THREE.MathUtils.lerp(layer.offsetMin[2], layer.offsetMax[2], Math.random())
      )).multiplyScalar(sourceUnit);
      const tint = new THREE.Color().setRGB(...layer.colorMin).lerp(new THREE.Color().setRGB(...layer.colorMax), Math.random());
      list.push({ age: 0, life: sample(layer.lifetime), offset,
        position: offset.clone().applyQuaternion(orientation).add(origin), velocity: new THREE.Vector3(),
        radius: sample(layer.radius)*sourceUnit, rotation: sample(layer.rotation), spin: sample(layer.spin), color: tint, alpha: sample(layer.alpha) });
    }
    const position = geometry.getAttribute('aPosition') as THREE.InstancedBufferAttribute;
    const color = geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const radius = geometry.getAttribute('aRadius') as THREE.InstancedBufferAttribute;
    const alpha = geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    const rotation = geometry.getAttribute('aRotation') as THREE.InstancedBufferAttribute;
    let count = 0;
    for (const p of list) {
      p.age += delta;
      if (p.age >= p.life) continue;
      p.velocity.addScaledVector(gravity, delta).multiplyScalar(Math.exp(-layer.drag*delta));
      p.position.addScaledVector(p.velocity, delta);
      p.rotation += p.spin*delta;
      const t = p.age/p.life;
      scratch.color.copy(p.color);
      if (layer.colorFade) scratch.color.lerp(new THREE.Color().setRGB(...layer.colorFade), t);
      position.setXYZ(count, p.position.x, p.position.y, p.position.z);
      color.setXYZ(count, scratch.color.r*layer.overbright, scratch.color.g*layer.overbright, scratch.color.b*layer.overbright);
      radius.setX(count, p.radius*Math.max(0, ageCurveValue(layer.radiusCurve, t)));
      alpha.setX(count, p.alpha*THREE.MathUtils.clamp(ageCurveValue(layer.alphaCurve, t), 0, 1));
      rotation.setX(count, p.rotation);
      list[count++] = p;
    }
    list.length = count;
    (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
    for (const attr of [position, color, radius, alpha, rotation]) attr.needsUpdate = true;
    previous.copy(origin);
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
