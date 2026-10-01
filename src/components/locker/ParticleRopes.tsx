import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ageCurveValue, paramScalar, spriteParamsFor, type FxDescriptor, type FxRenderer } from './fxDescriptor';
import { spritecardMaterial } from './spritecardMaterial';
import { orderedRopePoints, ropePositionSource } from './particleOrderedRope';
import { particleControlPointInputs } from './particleScalarInput';
import { MovingParticleRope } from './MovingParticleRope';
import { bindParticleSnapshot, skinnedSnapshotPosition } from './particleSnapshotSkinning';

const VERT = `uniform float ropeDepthBias; attribute float aAlpha; attribute vec3 aColor; varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
  void main(){vUv=uv;vAlpha=aAlpha;vColor=aColor;vec4 viewPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*viewPosition;
  if(ropeDepthBias!=0.0){viewPosition.z-=ropeDepthBias;vec4 biased=projectionMatrix*viewPosition;
  gl_Position.z=max(gl_Position.w*(biased.z/biased.w),min(.001,gl_Position.z));}}`;
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
  const ordered = useMemo(() => orderedRopePoints(system), [system]);
  const positionSource = ropePositionSource(bound?.length ?? 0, ordered?.points.length ?? 0);
  const snapshotSubdivisions = Math.floor(Math.max(1, Math.min(8, paramScalar(renderer.params.m_nMaxTesselation, 1))));
  const count = positionSource === 'ordered' && ordered ? Math.min(2048, (ordered.points.length-1)*Math.max(4, Math.min(16, paramScalar(renderer.params.m_nMinTesselation, 4)))+1) : bound?.length ? (bound.length-1)*snapshotSubdivisions+1 : 0;
  const orderedCurve = useMemo(() => ordered ? new THREE.CatmullRomCurve3(ordered.points.map(p => new THREE.Vector3(...p.position))) : null, [ordered]);
  const orderedAttribute = (i: number, key: 'radius' | 'alpha' | 'scalarUv') => {
    if (!ordered) return 0;
    const fraction = i/(count-1)*(ordered.points.length-1), lo = Math.floor(fraction), hi = Math.min(lo+1, ordered.points.length-1);
    return THREE.MathUtils.lerp(ordered.points[lo][key], ordered.points[hi][key], fraction-lo);
  };
  const snapshotAttribute = (i: number, field: number, fallback: number) => {
    if (!bound?.length) return fallback;
    // Snapshot particles use number/count, not number/(count-1). Tessellation
    // interpolates their initialized attributes rather than resampling curves.
    const fraction = i/(count-1)*(bound.length-1), lo = Math.floor(fraction), hi = Math.min(lo+1, bound.length-1);
    return THREE.MathUtils.lerp(attributeAt(system, field, lo/bound.length, fallback),
      attributeAt(system, field, hi/bound.length, fallback), fraction-lo);
  };
  const resource = useMemo(() => {
    const result = spritecardMaterial(renderer, textureBaseUrl, VERT, true);
    if (!result) return null;
    const depthBias = { value: 0 };
    result.material.uniforms.ropeDepthBias = depthBias;
    return { ...result, setDepthBias(value: number) { depthBias.value = value; } };
  }, [renderer, textureBaseUrl]);
  const geometry = useMemo(() => {
    const n = count, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n*4), 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n*2), 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n*6), 3));
    g.setIndex(Array.from({ length: Math.max(0, n-1) }, (_, i) => [i*2, i*2+1, i*2+2, i*2+1, i*2+3, i*2+2]).flat());
    return g;
  }, [count]);
  const tint = useMemo(() => spriteParamsFor(system, renderer)?.colorMin ?? [1,1,1], [system,renderer]);
  const state = useMemo(() => ({ sourcePoints: Array.from({length: bound?.length ?? 0}, () => new THREE.Vector3()), points: Array.from({length: count}, () => new THREE.Vector3()), scratch: new THREE.Vector3(), tangent: new THREE.Vector3(), eye: new THREE.Vector3(), side: new THREE.Vector3(), worldScale: new THREE.Vector3() }), [count, bound]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { resource?.material.dispose(); resource?.textures.forEach((t) => t.dispose()); }, [resource]);
  useEffect(() => { clock.current = 0; }, [system]);
  useFrame(({ camera }, delta) => {
    if ((!bound?.length && !ordered) || !resource || !ref.current?.parent) return;
    if (!playback?.paused) clock.current += Math.max(0, Math.min(.1, delta*(playback?.speed ?? 1)));
    ref.current.visible = clock.current >= delay+(ordered?.start ?? 0);
    resource.update(Math.max(0, clock.current-delay));
    const sourceRoot = model.getObjectByName('skeleton');
    if (positionSource === 'snapshot' && bound) {
      bound.forEach((point,i)=>skinnedSnapshotPosition(point,state.sourcePoints[i],state.scratch));
      const curve = new THREE.CatmullRomCurve3(state.sourcePoints);
      state.points.forEach((point,i)=>curve.getPoint(i/(count-1),point));
    }
    for (let i = 0; i < state.points.length; i++) {
      if (positionSource !== 'snapshot' && ordered && orderedCurve) {
        orderedCurve.getPoint(i/(count-1), state.points[i]).multiplyScalar(scale).applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.max(0, clock.current-delay)*ordered.orbitRate);
        if (sourceRoot) sourceRoot.localToWorld(state.points[i]);
        else { state.points[i].multiplyScalar(.0254).applyQuaternion(new THREE.Quaternion(.5,.5,.5,.5).invert()); model.localToWorld(state.points[i]); }
      }
    }
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), alpha = geometry.getAttribute('aAlpha'), color = geometry.getAttribute('aColor');
    const sourceUnit = model.getObjectByName('skeleton')?.getWorldScale(state.worldScale).x ?? .0254;
    // Authored world-unit bias changes depth only, preserving the ribbon silhouette.
    resource.setDepthBias(paramScalar(renderer.params.m_flDepthBias, 0)*Math.abs(sourceUnit)*scale);
    const radiusScale = Math.max(0, Math.min(16, paramScalar(renderer.params.m_flRadiusScale, 1)));
    const worldVSize = Math.max(.001, paramScalar(renderer.params.m_flTextureVWorldSize, 1))*sourceUnit;
    let arc = 0;
    for (let i = 0; i < state.points.length; i++) {
      const p = state.points[i];
      if (i) arc += p.distanceTo(state.points[i-1]);
      state.tangent.copy(state.points[Math.min(i+1, state.points.length-1)]).sub(state.points[Math.max(i-1, 0)]).normalize();
      camera.getWorldPosition(state.eye).sub(p).normalize();
      state.side.crossVectors(state.tangent, state.eye).normalize().multiplyScalar((ordered ? orderedAttribute(i, 'radius') : snapshotAttribute(i, 3, paramScalar(system.constantRadius, 1)))*sourceUnit*scale*radiusScale);
      for (let edge = 0; edge < 2; edge++) {
        state.scratch.copy(p).addScaledVector(state.side, edge ? 1 : -1); ref.current.parent.worldToLocal(state.scratch);
        positions.setXYZ(i*2+edge, state.scratch.x, state.scratch.y, state.scratch.z);
        uv.setXY(i*2+edge, edge, (ordered && renderer.params.m_bUseScalarForTextureCoordinate === true ? orderedAttribute(i, 'scalarUv') : arc/worldVSize)+clock.current*paramScalar(renderer.params.m_flTextureVScrollRate, 0));
        alpha.setX(i*2+edge, (ordered ? orderedAttribute(i, 'alpha') : Math.min(1, snapshotAttribute(i, 7, 1))*Math.min(1,snapshotAttribute(i,39,1)))*paramScalar(renderer.params.m_flAlphaScale, 1));
        color.setXYZ(i*2+edge,tint[0],tint[1],tint[2]);
      }
    }
    positions.needsUpdate = uv.needsUpdate = alpha.needsUpdate = color.needsUpdate = true;
  });
  if ((!bound?.length && !ordered) || !resource) return null;
  return <mesh ref={ref} geometry={geometry} material={resource.material} frustumCulled={false} />;
}

export function ParticleRopes({ descriptor, model, textureBaseUrl, playback }: {
  descriptor: FxDescriptor; model?: THREE.Object3D; textureBaseUrl: string; playback?: { paused: boolean; speed: number };
}) {
  const layers = useMemo(() => {
    const result: Array<{ system: FxDescriptor; renderer: FxRenderer; delay: number; moving?: boolean }> = [];
    let systems = 0;
    const visit = (system: FxDescriptor, depth: number, delay: number) => {
      if (++systems > 32 || depth > 4) return;
      delay += Math.max(0, Math.min(30, paramScalar(system.startDelay, 0)));
      if (orderedRopePoints(system) || (system.snapshot && system.initializers.some((n) => n.class === 'C_INIT_InitSkinnedPositionFromCPSnapshot')
        && system.operators.some((n) => n.class === 'C_OP_SnapshotRigidSkinToBones'))) {
        for (const renderer of system.renderers) if (renderer.mode === 'rope' && result.length < 8) result.push({ system, renderer, delay });
      } else if (system.initializers.some(n => n.class === 'C_INIT_CreateWithinSphereTransform') && system.operators.some(n => n.class === 'C_OP_BasicMovement')) {
        for (const renderer of system.renderers) if (renderer.mode === 'rope' && result.length < 8) result.push({system,renderer,delay,moving:true});
      }
      system.children.slice(0, 16).forEach((child) => visit(child, depth+1, delay));
    };
    visit(descriptor, 0, 0); return result;
  }, [descriptor]);
  if (!model) return null;
  return <group>{layers.map((layer, i) => layer.moving
    ? <MovingParticleRope key={i} {...layer} controlPointComponents={particleControlPointInputs(descriptor.previewControlPointComponents, { ...descriptor.controlPointComponents, ...layer.system.controlPointComponents })} attachments={descriptor.attachments} model={model} textureBaseUrl={textureBaseUrl} playback={playback} scale={paramScalar(descriptor.scale, 1)} />
    : <RopeLayer key={i} {...layer} model={model} textureBaseUrl={textureBaseUrl} playback={playback} scale={paramScalar(descriptor.scale, 1)} />)}</group>;
}
