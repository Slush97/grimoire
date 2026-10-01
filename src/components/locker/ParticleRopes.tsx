import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ageCurveValue, fxTexturePngName, paramScalar, spriteGradientColor, type FxDescriptor, type FxRenderer } from './fxDescriptor';
import { bindParticleSnapshot, skinnedSnapshotPosition } from './particleSnapshotSkinning';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const scalar = (v: unknown, age: number, fallback: number) => {
  const p = row(v);
  return p.pf === 'PF_TYPE_COLLECTION_AGE' ? age*paramScalar(p.mult, 1) : paramScalar(v, fallback);
};
const VERT = `attribute float aAlpha; varying vec2 vUv; varying float vAlpha;
  void main(){vUv=uv;vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

/** Bounded self-illuminated spritecard chain: diffuse, UV-distortion and 1D
 * lookup, generated ramps, multiply/replace and RGBA/RGB-alpha channel modes. */
function ropeMaterial(renderer: FxRenderer, base: string) {
  const inputs = Array.isArray(renderer.params.m_vecTexturesInput) ? renderer.params.m_vecTexturesInput.map(row).filter((r) => r.m_bEnabled !== false).slice(0, 5) : [];
  if (!inputs.length || paramScalar(renderer.params.m_flSelfIllumAmount, 0) !== 1 || paramScalar(renderer.params.m_flDiffuseAmount, 1) !== 0) return null;
  const textures: THREE.Texture[] = [];
  const uniforms: Record<string, THREE.IUniform> = {};
  let declarations = '', chain = '', previous = 0;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i], control = row(input.m_TextureControls);
    const type = input.m_nTextureType ?? 'SPRITECARD_TEXTURE_DIFFUSE';
    const channel = input.m_nTextureChannels ?? 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA';
    const blend = input.m_nTextureBlendMode ?? 'SPRITECARD_TEXTURE_BLEND_MULTIPLY';
    if (!['SPRITECARD_TEXTURE_DIFFUSE', 'SPRITECARD_TEXTURE_UVDISTORTION', 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP'].includes(String(type))
      || !['SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA', 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA'].includes(String(channel))
      || !['SPRITECARD_TEXTURE_BLEND_MULTIPLY', 'SPRITECARD_TEXTURE_BLEND_REPLACE'].includes(String(blend))) {
      textures.forEach((t) => t.dispose()); return null;
    }
    let texture: THREE.Texture;
    if (input.m_bReplaceTextureWithGradient === true) {
      const bytes = new Uint8Array(256*4);
      for (let k = 0; k < 256; k++) {
        const color = spriteGradientColor({ m_nType: 'PVEC_TYPE_FLOAT_INTERP_GRADIENT', m_FloatInterp: { pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED' }, m_Gradient: input.m_Gradient }, k/255);
        if (!color) { textures.forEach((t) => t.dispose()); return null; }
        bytes.set([...color.map((v) => Math.round(v*255)), 255], k*4);
      }
      texture = new THREE.DataTexture(bytes, 256, 1); texture.needsUpdate = true;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
    } else {
      if (typeof input.m_hTexture !== 'string' || !renderer.textures.includes(input.m_hTexture)) { textures.forEach((t) => t.dispose()); return null; }
      texture = new THREE.TextureLoader().load(base+fxTexturePngName(input.m_hTexture));
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = control.m_bClampUVs === true ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    textures.push(texture);
    uniforms[`tex${i}`] = { value: texture };
    uniforms[`uv${i}`] = { value: new THREE.Vector4(1, 1, 0, 0) };
    uniforms[`rot${i}`] = { value: 0 }; uniforms[`dist${i}`] = { value: 0 };
    uniforms[`blend${i}`] = { value: 1 };
    declarations += `uniform sampler2D tex${i}; uniform vec4 uv${i}; uniform float rot${i}; uniform float dist${i}; uniform float blend${i};\n`;
    chain += `vec2 p${i}=placeUv(vUv,uv${i},rot${i});`;
    if (control.m_bClampUVs === true) chain += `p${i}=clamp(p${i},0.0,1.0);`;
    chain += `vec4 t${i}=texture2D(tex${i},p${i});`;
    if (type === 'SPRITECARD_TEXTURE_UVDISTORTION' && i > 0) chain += `t${i}=texture2D(tex${previous},p${previous}-(gammaColor(t${i}.rgb).xy-0.5)*2.0*(dist${i}*0.125*t${i}.a));`;
    if (type === 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP') chain += `t${i}=vec4(texture2D(tex${i},vec2(dot(gammaColor(accum.rgb),vec3(.299,.587,.114)),.5)).rgb,accum.a);`;
    if (channel === 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA') chain += `t${i}.a=dot(t${i}.rgb,vec3(.299,.587,.114));`;
    chain += `accum=max(mix(accum,${blend === 'SPRITECARD_TEXTURE_BLEND_REPLACE' ? `t${i}` : `accum*t${i}`},blend${i}),vec4(0.0));`;
    previous = i;
  }
  const color = row(renderer.params.m_vecColorScale);
  const colorScale = color.m_nType === 'PVEC_TYPE_LITERAL_COLOR' && Array.isArray(color.m_LiteralColor) ? color.m_LiteralColor : [255, 255, 255];
  uniforms.tint = { value: new THREE.Vector3(...colorScale.map((v) => Math.max(0, Math.min(255, Number(v)))/255) as [number, number, number]) };
  uniforms.overbright = { value: Math.max(0, Math.min(16, paramScalar(renderer.params.m_flOverbrightFactor, 1))) };
  uniforms.desat = { value: Math.max(0, Math.min(1, paramScalar(renderer.params.m_flDesaturation, 0))) };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: `
    ${declarations} uniform vec3 tint; uniform float overbright; uniform float desat;
    varying vec2 vUv; varying float vAlpha;
    vec3 gammaColor(vec3 c){return mix(12.92*c,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
    vec2 placeUv(vec2 p,vec4 ctl,float angle){float c=cos(angle),s=sin(angle);p-=.5;return vec2(c*p.x-s*p.y,s*p.x+c*p.y)/ctl.xy+fract(ctl.zw+.5);}
    void main(){vec4 accum=vec4(1.0);${chain}
      vec3 rgb=accum.rgb*tint;rgb=mix(rgb,vec3(dot(rgb,vec3(.299,.587,.114))),desat)*overbright;
      ${renderer.params.m_bSaturateColorPreAlphaBlend === false ? '' : 'rgb=clamp(rgb,0.0,1.0);'}
      float alpha=smoothstep(0.0,1.0,accum.a)*vAlpha;
      float coverage=clamp(max(max(rgb.r,rgb.g),rgb.b),0.0,1.0);alpha*=coverage;rgb/=max(coverage,.0001);
      if(alpha<=.001)discard;gl_FragColor=vec4(rgb,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  return { material, textures, update(age: number) {
    inputs.forEach((input, i) => {
      const c = row(input.m_TextureControls);
      (uniforms[`uv${i}`].value as THREE.Vector4).set(Math.max(.001, scalar(c.m_flFinalTextureScaleU, age, 1)), Math.max(.001, scalar(c.m_flFinalTextureScaleV, age, 1)), scalar(c.m_flFinalTextureOffsetU, age, 0), scalar(c.m_flFinalTextureOffsetV, age, 0));
      uniforms[`rot${i}`].value = scalar(c.m_flFinalTextureUVRotation, age, 0);
      uniforms[`dist${i}`].value = scalar(c.m_flDistortion, age, 0);
      uniforms[`blend${i}`].value = Math.max(0, Math.min(1, scalar(input.m_flTextureBlend, age, 1)));
    });
  } };
}

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
  const resource = useMemo(() => ropeMaterial(renderer, textureBaseUrl), [renderer, textureBaseUrl]);
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
      if (++systems > 16 || depth > 4) return;
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
