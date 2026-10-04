import * as THREE from 'three';
import { fxTexturePngName, paramScalar, spriteGradientColor, type FxRenderer } from './fxDescriptor';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const scalar = (v: unknown, age: number, fallback: number) => {
  const p = row(v);
  return p.pf === 'PF_TYPE_COLLECTION_AGE' ? age*paramScalar(p.mult, 1) : paramScalar(v, fallback);
};


/** Bounded self-illuminated spritecard chain: diffuse, UV-distortion and 1D
 * lookup, generated ramps, multiply/replace/subtract and RGBA/alpha channels. */
export function spritecardMaterial(renderer: FxRenderer, base: string, vertexShader: string, vertexColor = false, frameRegion = false) {
  const additive = (renderer.blendMode ?? '').includes('ADD');
  const inputs = Array.isArray(renderer.params.m_vecTexturesInput) ? renderer.params.m_vecTexturesInput.map(row).filter((r) => r.m_bEnabled !== false).slice(0, 5) : [];
  const selfIllum = paramScalar(renderer.params.m_flSelfIllumAmount, 0);
  if (!inputs.length || selfIllum <= 0 || selfIllum > 1 || paramScalar(renderer.params.m_flDiffuseAmount, 0) !== 0) return null;
  const textures: THREE.Texture[] = [];
  const uniforms: Record<string, THREE.IUniform> = {};
  let declarations = '', chain = '', previous = 0;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i], control = row(input.m_TextureControls);
    const type = input.m_nTextureType ?? 'SPRITECARD_TEXTURE_DIFFUSE';
    const channel = input.m_nTextureChannels ?? 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA';
    const blend = input.m_nTextureBlendMode ?? 'SPRITECARD_TEXTURE_BLEND_MULTIPLY';
    if (!['SPRITECARD_TEXTURE_DIFFUSE', 'SPRITECARD_TEXTURE_UVDISTORTION', 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP'].includes(String(type))
      || !['SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA', 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA', 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGB', 'SPRITECARD_TEXTURE_CHANNEL_MIX_A'].includes(String(channel))
      || !['SPRITECARD_TEXTURE_BLEND_MULTIPLY', 'SPRITECARD_TEXTURE_BLEND_REPLACE', 'SPRITECARD_TEXTURE_BLEND_SUBTRACT', 'SPRITECARD_TEXTURE_BLEND_ADD'].includes(String(blend))) {
      textures.forEach((t) => t.dispose()); return null;
    }
    let texture: THREE.Texture;
    if (input.m_bReplaceTextureWithGradient === true) {
      // Source 2 uses a white texture when an authored gradient has no stops.
      // Rejecting it silently removes otherwise supported smoke ropes.
      const stops = row(input.m_Gradient).m_Stops;
      const emptyGradient = !Array.isArray(stops) || stops.length === 0;
      const bytes = new Uint8Array(256*4);
      for (let k = 0; k < 256; k++) {
        const color = emptyGradient ? [1, 1, 1] : spriteGradientColor({ m_nType: 'PVEC_TYPE_FLOAT_INTERP_GRADIENT', m_FloatInterp: { pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED' }, m_Gradient: input.m_Gradient }, k/255);
        if (!color) { textures.forEach((t) => t.dispose()); return null; }
        bytes.set([...color.map((v) => Math.round(v*255)), 255], k*4);
      }
      texture = new THREE.DataTexture(bytes, 256, 1); texture.needsUpdate = true;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
    } else {
      if (typeof input.m_hTexture !== 'string' || !renderer.textures.includes(input.m_hTexture)) { textures.forEach((t) => t.dispose()); return null; }
      texture = new THREE.TextureLoader().load(base+fxTexturePngName(input.m_hTexture));
    }
    // Authored gradient stops are linear color bytes. Texture-file pixels are
    // sRGB; applying that decode to generated gradients darkens their coverage.
    texture.colorSpace = input.m_bReplaceTextureWithGradient === true ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = input.m_bReplaceTextureWithGradient === true || control.m_bClampUVs === true ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    textures.push(texture);
    uniforms[`tex${i}`] = { value: texture };
    uniforms[`uv${i}`] = { value: new THREE.Vector4(1, 1, 0, 0) };
    uniforms[`rot${i}`] = { value: 0 }; uniforms[`dist${i}`] = { value: 0 };
    uniforms[`blend${i}`] = { value: 1 };
    declarations += `uniform sampler2D tex${i}; uniform vec4 uv${i}; uniform float rot${i}; uniform float dist${i}; uniform float blend${i};\n`;
    chain += `vec2 p${i}=placeUv(${frameRegion ? 'vCardUv' : 'vUv'},uv${i},rot${i});`;
    if (control.m_bClampUVs === true) chain += `p${i}=clamp(p${i},0.0,1.0);`;
    if (frameRegion && i === 0) chain += 'p0=mix(vFrameRegion.xy,vFrameRegion.zw,p0);if(vFrameClamp>.5)p0=clamp(p0,vFrameRegion.xy,vFrameRegion.zw);';
    chain += `vec4 t${i}=texture2D(tex${i},p${i});`;
    if (type === 'SPRITECARD_TEXTURE_UVDISTORTION' && i > 0) {
      chain += `vec2 warped${i}=p${previous}-(gammaColor(t${i}.rgb).xy-0.5)*2.0*(dist${i}*0.125*t${i}.a);`;
      if (frameRegion && previous === 0) chain += `if(vFrameClamp>.5)warped${i}=clamp(warped${i},vFrameRegion.xy,vFrameRegion.zw);`;
      chain += `t${i}=texture2D(tex${previous},warped${i});`;
    }
    if (type === 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP') {
      // The RGBA ramp reads covered color, unlike an RGB-only ramp. VRF's
      // MASK_RAMP_FLAGS (RGBA=1) premultiplies before gamma/luma.
      // Otherwise faint detail fringes select the same bright ramp as its core.
      // Keep the existing RGBALPHA coverage approximation unchanged here.
      const rampSource = channel === 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA' ? 'accum.rgb*accum.a' : 'accum.rgb';
      chain += `t${i}=vec4(texture2D(tex${i},vec2(dot(gammaColor(${rampSource}),vec3(.299,.587,.114)),.5)).rgb,accum.a);`;
    }
    // A color lookup inherits the incoming shape's coverage. RGB-to-alpha must
    // modulate that coverage, never resurrect transparent radial-mask corners.
    if (channel === 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA') chain += `t${i}.a=${type === 'SPRITECARD_TEXTURE_1D_COLOR_LOOKUP' ? `t${i}.a*` : ''}dot(t${i}.rgb,vec3(.299,.587,.114));`;
    if (channel === 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGB') chain += `t${i}.a=${blend === 'SPRITECARD_TEXTURE_BLEND_REPLACE' ? 'accum.a' : blend === 'SPRITECARD_TEXTURE_BLEND_MULTIPLY' ? '1.0' : '0.0'};`;
    if (channel === 'SPRITECARD_TEXTURE_CHANNEL_MIX_A') chain += `t${i}=vec4(${blend === 'SPRITECARD_TEXTURE_BLEND_SUBTRACT' ? 'vec3(0.0)' : blend === 'SPRITECARD_TEXTURE_BLEND_REPLACE' ? 'accum.rgb' : 'vec3(1.0)'},t${i}.a);`;
    chain += `accum=max(mix(accum,${blend === 'SPRITECARD_TEXTURE_BLEND_REPLACE' ? `t${i}` : blend === 'SPRITECARD_TEXTURE_BLEND_SUBTRACT' ? `accum-t${i}` : blend === 'SPRITECARD_TEXTURE_BLEND_ADD' ? `accum+t${i}` : `accum*t${i}`},blend${i}),vec4(0.0));`;
    previous = i;
  }
  const color = row(renderer.params.m_vecColorScale);
  const colorScale = color.m_nType === 'PVEC_TYPE_LITERAL_COLOR' && Array.isArray(color.m_LiteralColor) ? color.m_LiteralColor : [255, 255, 255];
  uniforms.tint = { value: new THREE.Vector3(...colorScale.map((v) => Math.max(0, Math.min(255, Number(v)))/255) as [number, number, number]) };
  uniforms.overbright = { value: selfIllum*Math.max(0, Math.min(32, paramScalar(renderer.params.m_flOverbrightFactor, 1))) };
  // VRF b20af381 particle_spritecard.frag.slang: additive self color is applied
  // after saturation, allowing authored glow to retain HDR radiance.
  uniforms.addSelf = { value: 1 + Math.max(0, Math.min(32, paramScalar(renderer.params.m_flAddSelfAmount, 0))) };
  uniforms.desat = { value: Math.max(0, Math.min(1, paramScalar(renderer.params.m_flDesaturation, 0))) };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: `
    ${declarations} uniform vec3 tint; uniform float overbright; uniform float addSelf; uniform float desat;
    varying vec2 vUv; varying float vAlpha; ${vertexColor ? "varying vec3 vColor;" : ""}
    ${frameRegion ? 'varying vec2 vCardUv; varying vec4 vFrameRegion; varying float vFrameClamp;' : ''}
    vec3 gammaColor(vec3 c){return mix(12.92*c,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
    vec2 placeUv(vec2 p,vec4 ctl,float angle){float c=cos(angle),s=sin(angle);p-=.5;return vec2(c*p.x-s*p.y,s*p.x+c*p.y)/ctl.xy+fract(ctl.zw+.5);}
    void main(){vec4 accum=vec4(1.0);${chain}
      vec3 rgb=accum.rgb*tint${vertexColor ? "*vColor" : ""};rgb=mix(rgb,vec3(dot(rgb,vec3(.299,.587,.114))),desat)*overbright;
      ${renderer.params.m_bSaturateColorPreAlphaBlend === false ? '' : 'rgb=clamp(rgb,0.0,1.0);'}
      rgb*=addSelf;
      float alpha=smoothstep(0.0,1.0,accum.a)*vAlpha;
      ${additive ? 'float coverage=clamp(max(max(rgb.r,rgb.g),rgb.b),0.0,1.0);alpha*=coverage;rgb/=max(coverage,.0001);' : ''}
      if(alpha<=.001)discard;gl_FragColor=vec4(rgb,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  material.userData.previewBloom = true;
  return { material, textures, update(age: number) {
    inputs.forEach((input, i) => {
      const c = row(input.m_TextureControls);
      const signedScale = (v: unknown) => { const value = scalar(v, age, 1); return Math.abs(value) < .001 ? (value < 0 ? -.001 : .001) : value; };
      (uniforms[`uv${i}`].value as THREE.Vector4).set(signedScale(c.m_flFinalTextureScaleU), signedScale(c.m_flFinalTextureScaleV), scalar(c.m_flFinalTextureOffsetU, age, 0), scalar(c.m_flFinalTextureOffsetV, age, 0));
      uniforms[`rot${i}`].value = scalar(c.m_flFinalTextureUVRotation, age, 0)*Math.PI/180;
      uniforms[`dist${i}`].value = scalar(c.m_flDistortion, age, 0);
      uniforms[`blend${i}`].value = Math.max(0, Math.min(1, scalar(input.m_flTextureBlend, age, 1)));
    });
  } };
}
