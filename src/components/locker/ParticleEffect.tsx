/**
 * Renders an FX descriptor's sprite layers as additive billboard clusters on the
 * hero preview turntable. First slice of the effects-preview axis: a CPU sprite
 * sim driving a custom-shader `THREE.Points` (per-particle size + alpha + texture,
 * which plain `PointsMaterial` can't do -- it gives flat uniform dots that don't
 * read as VFX). Rope/model/light layers are skipped (see
 * `fxDescriptor.allSpriteLayers`).
 *
 * This is deliberately **preview-grade, not engine-faithful**: the sim fills the
 * particle budget for legibility, grows/fades each sprite over its life, and adds
 * a gentle orbit so the aura reads as alive, rather than reproducing the engine's
 * exact ~2/sec emit. Frame-exact playback is a later step (three.quarks / full
 * operator mapping), as is anchoring to the hand attachment (CP injection) and the
 * RandomColor/ColorInterpolate tint -- today layers spawn at the model origin and
 * use the descriptor's constant color.
 *
 * Point size is screen-space (px), NOT world units: the parent model group is
 * scaled ~0.01 (cm bounds normalized to a 2-unit view) and world-space point size
 * ignores that parent scale, so a world size renders fullscreen. Mount inside the
 * model's normalized group so positions share its centering. Data comes from
 * `vpkmerge particle ... --out effect.json --textures-dir tex/`, served over the
 * `grimoire-hero:` scheme.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  allSpriteLayers,
  fxTexturePngName,
  type FxDescriptor,
  type SpriteSimParams,
} from './fxDescriptor';

/** Screen-space billboard size range (px). */
const MIN_POINT_PX = 8;
const MAX_POINT_PX = 64;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Round soft falloff when there's no texture; otherwise sample the sprite.
    vec2 uv = gl_PointCoord;
    float d = length(uv - vec2(0.5));
    vec4 tex = uHasMap > 0.5 ? texture2D(map, uv) : vec4(smoothstep(0.5, 0.0, d));
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (gl_FragColor.a <= 0.001) discard;
  }
`;

interface Particle {
  age: number;
  life: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Tangential orbit angular speed (rad/s) about the spawn axis. */
  orbit: number;
  baseSize: number;
}

/** One additive billboard cluster for a single sprite layer. */
function SpriteLayer({ layer, textureBaseUrl }: { layer: SpriteSimParams; textureBaseUrl: string }) {
  const pointsRef = useRef<THREE.Points>(null);
  const particles = useRef<Particle[]>([]);
  const spawnAcc = useRef(0);

  const texture = useMemo(() => {
    if (!layer.texture) return null;
    const tex = new THREE.TextureLoader().load(textureBaseUrl + fxTexturePngName(layer.texture));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [layer.texture, textureBaseUrl]);

  const cap = Math.max(8, layer.maxParticles);
  const baseSize = THREE.MathUtils.clamp(layer.radius * 1.6, MIN_POINT_PX, MAX_POINT_PX);

  const { geometry, material } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    geom.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(cap), 1));
    geom.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(cap), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uHasMap: { value: texture ? 1 : 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: layer.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    return { geometry: geom, material: mat };
  }, [cap, layer.additive, texture]);

  useEffect(
    () => () => {
      texture?.dispose();
      geometry.dispose();
      material.dispose();
    },
    [texture, geometry, material]
  );

  useFrame((_, deltaRaw) => {
    const delta = Math.min(deltaRaw, 0.05);
    const points = pointsRef.current;
    if (!points) return;
    const list = particles.current;
    const avgLife = (layer.lifetime[0] + layer.lifetime[1]) / 2 || 1;

    // Preview density: keep the budget roughly full (steady-state = cap), rather
    // than the engine's literal emit rate, so the aura reads instead of being a
    // few stray dots.
    spawnAcc.current += (cap / avgLife) * delta;
    while (spawnAcc.current >= 1 && list.length < cap) {
      spawnAcc.current -= 1;
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      const r = Math.cbrt(Math.random()) * Math.max(layer.spawnRadius, layer.radius);
      list.push({
        age: 0,
        life: THREE.MathUtils.lerp(layer.lifetime[0], layer.lifetime[1], Math.random()),
        pos: dir.clone().multiplyScalar(r),
        vel: dir.clone().multiplyScalar(layer.drift + layer.radius * 0.5),
        orbit: THREE.MathUtils.lerp(-2, 2, Math.random()),
        baseSize: baseSize * (0.6 + Math.random() * 0.6),
      });
    }

    const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const size = points.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    let w = 0;
    for (const p of list) {
      p.age += delta;
      if (p.age >= p.life) continue;
      // Gentle orbit about Y + the radial drift, so the cluster swirls.
      const a = p.orbit * delta;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const x = p.pos.x * cos - p.pos.z * sin;
      const z = p.pos.x * sin + p.pos.z * cos;
      p.pos.x = x;
      p.pos.z = z;
      p.pos.addScaledVector(p.vel, delta);
      const t = p.age / p.life;
      const env = Math.sin(Math.min(t, 1) * Math.PI); // fade in/out
      pos.setXYZ(w, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZ(w, layer.color[0], layer.color[1], layer.color[2]);
      size.setX(w, p.baseSize * (0.5 + 0.5 * env));
      alpha.setX(w, env);
      w++;
    }
    if (w < list.length) {
      particles.current = list.filter((p) => p.age < p.life);
    }
    points.geometry.setDrawRange(0, w);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

/** Renders all sprite layers of a descriptor. `textureBaseUrl` must end in `/`
 *  and point at the bundle's texture dir served over `grimoire-hero:`. */
export function ParticleEffect({
  descriptor,
  textureBaseUrl,
}: {
  descriptor: FxDescriptor;
  textureBaseUrl: string;
}) {
  const layers = useMemo(() => allSpriteLayers(descriptor), [descriptor]);
  return (
    <group>
      {layers.map((layer, i) => (
        <SpriteLayer key={i} layer={layer} textureBaseUrl={textureBaseUrl} />
      ))}
    </group>
  );
}
