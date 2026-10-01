import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { advanceSpriteEmission, ageCurveValue, paramScalar, spriteGradientColor, spriteParamsFor, type FxDescriptor, type FxRenderer, type SpriteEmissionState } from './fxDescriptor';
import { resolveParticleAttachment } from './particleAttachment';
import { particleScalarInput } from './particleScalarInput';
import { spritecardMaterial } from './spritecardMaterial';

const VERT = `attribute float aAlpha; attribute vec3 aColor; varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main(){vUv=uv;vAlpha=aAlpha;vColor=aColor;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
interface Point { position: THREE.Vector3; velocity: THREE.Vector3; age: number; life: number; radius: number }

/** Chronological particle ropes with authored local directional velocity,
 * world gravity, initial scalar fields and normalized-age width/color/alpha. */
export function MovingParticleRope({ system, renderer, model, textureBaseUrl, delay, scale, attachments, playback }: {
  system: FxDescriptor; renderer: FxRenderer; model: THREE.Object3D; textureBaseUrl: string; delay: number; scale: number;
  attachments?: FxDescriptor['attachments']; playback?: { paused: boolean; speed: number };
}) {
  const mesh = useRef<THREE.Mesh>(null), clock = useRef(0), points = useRef<Point[]>([]), emissions = useRef<SpriteEmissionState[]>([]), initialized = useRef(false);
  const params = useMemo(() => spriteParamsFor(system, renderer), [system, renderer]);
  const attachment = useMemo(() => resolveParticleAttachment(model, params?.attachment ?? null, attachments), [model, params, attachments]);
  const resource = useMemo(() => spritecardMaterial(renderer, textureBaseUrl, VERT, true), [renderer, textureBaseUrl]);
  const maximum = Math.max(2, Math.min(128, params?.maxParticles ?? 2));
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['uv', 2], ['aAlpha', 1], ['aColor', 3]] as const)
      g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(maximum*2*size), size).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(Array.from({length: maximum-1}, (_, i) => [2*i,2*i+1,2*i+2,2*i+1,2*i+3,2*i+2]).flat());
    return g;
  }, [maximum]);
  const state = useMemo(() => ({ origin: new THREE.Vector3(), previous: new THREE.Vector3(), shift: new THREE.Vector3(), orientation: new THREE.Quaternion(),
    sourceOrientation: new THREE.Quaternion(), rootScale: new THREE.Vector3(), gravity: new THREE.Vector3(), tangent: new THREE.Vector3(), eye: new THREE.Vector3(), side: new THREE.Vector3(), edge: new THREE.Vector3() }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => { resource?.material.dispose(); resource?.textures.forEach(t => t.dispose()); }, [resource]);
  useEffect(() => { clock.current = 0; points.current = []; emissions.current = []; initialized.current = false; }, [system]);
  useFrame(({camera}, rawDelta) => {
    if (!params || !resource || !mesh.current?.parent || !attachment.object || playback?.paused) return;
    const dt = Math.max(0, Math.min(.1, rawDelta*(playback?.speed ?? 1))); if (!dt) return;
    const source = model.getObjectByName('skeleton'), anchor = attachment.object;
    const unit = (source ? Math.abs(source.getWorldScale(state.rootScale).x) : .0254)*scale;
    if (source) source.getWorldQuaternion(state.sourceOrientation);
    else state.sourceOrientation.set(.5,.5,.5,.5).invert();
    anchor.getWorldQuaternion(state.orientation);
    state.origin.set(0,0,0);
    if (attachment.frame) { anchor.localToWorld(state.origin.fromArray(attachment.frame.position)); state.orientation.multiply(new THREE.Quaternion(...attachment.frame.rotation)); }
    else anchor.getWorldPosition(state.origin);
    if (!initialized.current) { state.previous.copy(state.origin); initialized.current = true; }
    state.shift.copy(state.origin).sub(state.previous);
    state.gravity.fromArray(params.gravity).multiplyScalar(unit).applyQuaternion(state.sourceOrientation);
    const list = points.current.filter(p => p.age+dt < p.life);
    const births = advanceSpriteEmission(params.emissions.map(e => ({...e,start:e.start+delay})), emissions.current, clock.current, clock.current+dt, maximum-list.length);
    clock.current += dt;
    for (const born of births) {
      let life = paramScalar(system.constantLifespan, 1), radius = paramScalar(system.constantRadius, 1);
      for (const n of system.initializers) if (n.class === 'C_INIT_InitFloat') {
        const field = paramScalar(n.params.m_nOutputField, 3), value = particleScalarInput(n.params.m_InputValue, {}, field === 1 ? life : radius);
        if (field === 1) life = n.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE' ? life*value : value;
        if (field === 3) radius = n.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE' ? radius*value : value;
      }
      const position = state.origin.clone();
      for (const offset of params.offsets) position.add(new THREE.Vector3(...offset.min.map((lo, i) => THREE.MathUtils.lerp(lo, offset.max[i], Math.random()))).multiplyScalar(unit).applyQuaternion(offset.local ? state.orientation : state.sourceOrientation));
      const velocity = new THREE.Vector3(...params.localSpeedMin.map((lo, i) => THREE.MathUtils.lerp(lo, params.localSpeedMax[i], Math.random()))).multiplyScalar(unit).applyQuaternion(state.orientation);
      list.push({ position, velocity, age: born-dt, life: Math.max(.01, Math.min(30, life)), radius: Math.max(0, Math.min(128, radius))*unit });
    }
    const lock = system.operators.find(n => n.class === 'C_OP_PositionLock');
    for (const p of list) {
      p.age += dt; const step = Math.min(dt, p.age), t = p.age/p.life;
      if (lock && t >= paramScalar(lock.params.m_flStartTime_min, 0) && t < paramScalar(lock.params.m_flEndTime_max, 1)) p.position.add(state.shift);
      p.velocity.multiplyScalar(Math.pow(1-params.drag, 30*step)).addScaledVector(state.gravity, step);
      p.position.addScaledVector(p.velocity, step);
    }
    points.current = list; mesh.current.visible = list.length >= 2;
    resource.update(Math.max(0, clock.current-delay));
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), alpha = geometry.getAttribute('aAlpha'), color = geometry.getAttribute('aColor');
    let arc = 0;
    for (let i=0;i<list.length;i++) {
      const p = list[i], t = p.age/p.life;
      if (i) arc += p.position.distanceTo(list[i-1].position);
      state.tangent.copy(list[Math.min(i+1,list.length-1)].position).sub(list[Math.max(0,i-1)].position).normalize();
      camera.getWorldPosition(state.eye).sub(p.position).normalize();
      state.side.crossVectors(state.tangent,state.eye).normalize().multiplyScalar(p.radius*params.radiusScale*Math.max(0,ageCurveValue(params.radiusCurve,t)));
      const tint = spriteGradientColor(params.colorGradient,t) ?? params.colorMin;
      for(let edge=0;edge<2;edge++) {
        state.edge.copy(p.position).addScaledVector(state.side,edge?1:-1);mesh.current.parent.worldToLocal(state.edge);
        positions.setXYZ(2*i+edge,state.edge.x,state.edge.y,state.edge.z);
        uv.setXY(2*i+edge,edge,arc/Math.max(.001,unit*paramScalar(renderer.params.m_flTextureVWorldSize,1)));
        alpha.setX(2*i+edge,params.alphaScale*Math.max(0,Math.min(1,ageCurveValue(params.alphaCurve,t))));
        color.setXYZ(2*i+edge,...tint);
      }
    }
    geometry.setDrawRange(0,Math.max(0,list.length-1)*6);
    for(const attribute of [positions,uv,alpha,color]) attribute.needsUpdate = true;
    state.previous.copy(state.origin);
  });
  if (!params || !resource || attachment.kind !== 'exact') return null;
  return <mesh ref={mesh} geometry={geometry} material={resource.material} frustumCulled={false} />;
}
