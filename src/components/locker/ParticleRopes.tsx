import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ageCurveValue, paramScalar, type FxDescriptor, type FxRenderer } from './fxDescriptor';
import { spritecardMaterial } from './spritecardMaterial';
import { bindParticleSnapshot, skinnedSnapshotPosition } from './particleSnapshotSkinning';

const VERT = `attribute float aAlpha; varying vec2 vUv; varying float vAlpha;
  void main(){vUv=uv;vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

function attributeAt(d: FxDescriptor, field: number, index: number, fallback: number) {
  let value = fallback;
  for (const node of d.initializers) {
    if (node.class !== 'C_INIT_InitFloat' || paramScalar(node.params.m_nOutputField, 3) !== field) continue;
    const input = row(node.params.m_InputValue);
    const next = input.pf === 'PF_TYPE_PARTICLE_NUMBER_NORMALIZED'
      ? ageCurveValue({ ...input, pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED' }, index, 1) : paramScalar(node.params.m_InputValue, 0);
    value = node.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE' ? value*next : next;
  }
  return Math.max(0, Math.min(128, value));
}

function RopeLayer({ system, renderer, scale, delay, model, textureBaseUrl, playback }: {
  system: FxDescriptor; renderer: FxRenderer; scale: number; delay: number; model: THREE.Object3D; textureBaseUrl: string;
  playback?: { paused: boolean; speed: number };
}) {
  const ref = useRef<THREE.Mesh>(null), clock = useRef(0);
  const bound = useMemo(() => bindParticleSnapshot(model, system.snapshot?.points ?? []), [model, system]);
  const resource = useMemo(() => spritecardMaterial(renderer, textureBaseUrl, VERT), [renderer, textureBaseUrl]);
  const geometry = useMemo(() => {
    const n = bound?.length ?? 0, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n*4), 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n*2), 1));
    g.setIndex(Array.from({ length: Math.max(0, n-1) }, (_, i) => [i*2, i*2+1, i*2+2, i*2+1, i*2+3, i*2+2]).flat());
    return g;
  }, [bound]);
  const state = useMemo(() => ({ points: (bound ?? []).map(() => new THREE.Vector3()), scratch: new THREE.Vector3(), tangent: new THREE.Vector3(), eye: new THREE.Vector3(), side: new THREE.Vector3(), worldScale: new THREE.Vector3() }), [bound]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { resource?.material.dispose(); resource?.textures.forEach((t) => t.dispose()); }, [resource]);
  useEffect(() => { clock.current = 0; }, [system]);
  useFrame(({ camera }, delta) => {
    if (!bound || !resource || !ref.current?.parent) return;
    if (!playback?.paused) clock.current += Math.max(0, Math.min(.1, delta*(playback?.speed ?? 1)));
    ref.current.visible = clock.current >= delay;
    resource.update(Math.max(0, clock.current-delay));
    for (let i = 0; i < bound.length; i++) skinnedSnapshotPosition(bound[i], state.points[i], state.scratch);
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), alpha = geometry.getAttribute('aAlpha');
    const sourceUnit = model.getObjectByName('skeleton')?.getWorldScale(state.worldScale).x ?? .0254;
    const radiusScale = Math.max(0, Math.min(16, paramScalar(renderer.params.m_flRadiusScale, 1)));
    const worldVSize = Math.max(.001, paramScalar(renderer.params.m_flTextureVWorldSize, 1))*sourceUnit;
    let arc = 0;
    for (let i = 0; i < bound.length; i++) {
      const p = state.points[i], t = i/(bound.length-1);
      if (i) arc += p.distanceTo(state.points[i-1]);
      state.tangent.copy(state.points[Math.min(i+1, bound.length-1)]).sub(state.points[Math.max(i-1, 0)]).normalize();
      camera.getWorldPosition(state.eye).sub(p).normalize();
      state.side.crossVectors(state.tangent, state.eye).normalize().multiplyScalar(attributeAt(system, 3, t, paramScalar(system.constantRadius, 1))*sourceUnit*scale*radiusScale);
      for (let edge = 0; edge < 2; edge++) {
        state.scratch.copy(p).addScaledVector(state.side, edge ? 1 : -1); ref.current.parent.worldToLocal(state.scratch);
        positions.setXYZ(i*2+edge, state.scratch.x, state.scratch.y, state.scratch.z);
        uv.setXY(i*2+edge, edge, arc/worldVSize+clock.current*paramScalar(renderer.params.m_flTextureVScrollRate, 0));
        alpha.setX(i*2+edge, Math.min(1, attributeAt(system, 7, t, 1))*paramScalar(renderer.params.m_flAlphaScale, 1));
      }
    }
    positions.needsUpdate = uv.needsUpdate = alpha.needsUpdate = true;
  });
  if (!bound || !resource) return null;
  return <mesh ref={ref} geometry={geometry} material={resource.material} frustumCulled={false} />;
}

export function ParticleRopes({ descriptor, model, textureBaseUrl, playback }: {
  descriptor: FxDescriptor; model?: THREE.Object3D; textureBaseUrl: string; playback?: { paused: boolean; speed: number };
}) {
  const layers = useMemo(() => {
    const result: Array<{ system: FxDescriptor; renderer: FxRenderer; delay: number }> = [];
    let systems = 0;
    const visit = (system: FxDescriptor, depth: number, delay: number) => {
      if (++systems > 32 || depth > 4) return;
      delay += Math.max(0, Math.min(30, paramScalar(system.startDelay, 0)));
      if (system.snapshot && system.initializers.some((n) => n.class === 'C_INIT_InitSkinnedPositionFromCPSnapshot')
        && system.operators.some((n) => n.class === 'C_OP_SnapshotRigidSkinToBones')) {
        for (const renderer of system.renderers) if (renderer.mode === 'rope' && result.length < 8) result.push({ system, renderer, delay });
      }
      system.children.slice(0, 16).forEach((child) => visit(child, depth+1, delay));
    };
    visit(descriptor, 0, 0); return result;
  }, [descriptor]);
  if (!model) return null;
  return <group>{layers.map((layer, i) => <RopeLayer key={i} {...layer} model={model} textureBaseUrl={textureBaseUrl} playback={playback} scale={paramScalar(descriptor.scale, 1)} />)}</group>;
}
