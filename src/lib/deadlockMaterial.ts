import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import {
  type MorphicExtras,
  type NprTuning,
  DEFAULT_NPR_TUNING,
  NPR_VERTEX,
  NPR_FRAGMENT,
  NPR_PATCH_MAP,
  getMorphic,
  flag,
  firstNumber,
  vectorColor,
  vector3,
  transmissiveTint,
  isMeaningfulMask,
  isTrueGlassMaterial,
  hasDynamicAlphaOverride,
  glassTransmissionTexture,
  translucentAlphaTexture,
  staticOpacityScale,
  requiresVertexColors,
  whiteFallback,
  albedoCsb,
  detailLayer,
  highlightLayer,
} from './source2NprMaterial';
import { compileScalarExpr, peakScalar } from './dynamicScalar';
// Shared blend-mode resolver (the cycle-free leaf of the source2Preview core).
import { resolveBlendMode } from './source2Preview/blendMode';

/**
 * Unified Deadlock NPR material builder (the Phase 0/1 single build pass).
 *
 * This is the one-build-pass replacement for the old two-pass
 * applySource2MaterialHints + wrapMaterialWithNpr pipeline. It collapses both
 * into a single call that:
 *   1. clones the GLTF base material into a material WE OWN (the base is NEVER
 *      mutated, so teardown is just dispose + restore the original reference),
 *   2. decides ALL Source 2 material state once on that owned clone (glass /
 *      translucent / additive / self-illum / sheen / backfaces / unlit / jitter),
 *   3. wraps the owned clone in the CSM carrying the cel + rim + tint + self-illum
 *      scroll GLSL (reused verbatim from source2NprMaterial.ts).
 *
 * Because the CSM is handed the throwaway owned clone (never the live GLTF base),
 * CSM's in-place onBeforeCompile / __csm mutation lands on the clone we own and
 * dispose, so unwrapNprBase is NOT needed on this path.
 *
 * Clone-up safety (load-bearing, learned from the spike): a fresh material is
 * created and the base is copied into it via
 * THREE.MeshStandardMaterial.prototype.copy.call(clone, base). Two crashes are
 * dodged this way:
 *   (a) MeshPhysicalMaterial.copy(standardSource) reads physical-only fields
 *       (clearcoatNormalScale, attenuationColor, ...) off the standard source and
 *       throws "Cannot read properties of undefined (reading 'x')". Routing
 *       through MeshStandardMaterial.prototype.copy only copies the standard
 *       fields both share.
 *   (b) Material.copy does JSON.parse(JSON.stringify(userData)), which throws on
 *       the THREE.Texture objects in userData.morphic.resolvedTextures. So the
 *       base's userData is cleared across the copy, then the ORIGINAL userData
 *       object is assigned to the clone BY REFERENCE (shared morphic extras,
 *       treated as immutable -- we only write material properties, never through
 *       userData.morphic).
 *
 * We clone up to MeshPhysicalMaterial only when physical features are needed
 * (F_GLASS, or F_SHEEN on a physical source); otherwise a MeshStandardMaterial
 * clone is sufficient. The choice is made once, up front, from the morphic flags.
 */

export interface DeadlockMaterialResult {
  /**
   * The CSM wrapping the owned clone. NOT instanceof MeshPhysicalMaterial (CSM
   * extends THREE.Material); it carries the clone's copied
   * isMeshStandardMaterial / isMeshPhysicalMaterial flags + proxied `type`, which
   * is what the renderer keys IBL/PMREM/transmission on. Do NOT feed this to code
   * that does `instanceof MeshPhysicalMaterial`.
   */
  material: THREE.Material;
  /** Per-material uniforms; mutate uTintColor.value for live recolor without a rebuild. */
  uniforms: Record<string, THREE.IUniform>;
  /** Mask clones THIS build created and is responsible for disposing on teardown. */
  ownedTextures: THREE.Texture[];
  /**
   * Tears down everything THIS build owns: the CSM, the owned base clone (CSM's
   * inherited dispose() does NOT free its base material -- failing to dispose the
   * clone leaks one material + its env program per hero load), and the owned mask
   * clones. The GLTF base is never mutated, so the caller only needs to restore
   * the original mesh.material reference after calling this.
   */
  dispose: () => void;
  /**
   * When self-illum scale is a Tier-1 dynamic expression (e.g. inferno body's
   * 0.5*sin(3*time())+0.5), the compiled per-frame fn the ticker calls each frame
   * to drive uSelfIllumPulse. Null for a static scale.
   */
  selfIllumPulseFn: ((t: number) => number) | null;
}

/**
 * Decide whether the owned clone must be a MeshPhysicalMaterial. Glass needs the
 * built-in transmission render pass; sheen needs the physical sheen lobe. A
 * MeshStandardMaterial clone is enough for everything else (translucent goo is an
 * alpha-blend, NOT a transmission material -- spike finding).
 */
function needsPhysical(morphic: MorphicExtras, base: THREE.Material): boolean {
  if (isTrueGlassMaterial(morphic, base)) return true;
  // Sheen is only meaningful when the source already exposes the physical lobe;
  // upgrading a plain standard material just for sheen is out of scope for v1.
  if (flag(morphic, 'F_SHEEN') && (base as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    return true;
  }
  return false;
}

// Above this a self-illum scale counts as "on" for a material with a REAL
// (localizing) mask. Tuned to clear viscous_body's authored 0.02 (must stay dark)
// while admitting viscous_head's 0.629.
// ponytail: single threshold; revisit if a hero ships a real scale in (0.02, 0.05].
const SI_SCALE_EPS = 0.05;

// Above this a self-illum scale counts as "on" when the mask is a PLACEHOLDER, i.e.
// the glow falls back to full-coverage white over the whole surface (uSelfIllumMap =
// whiteFallback). That washes the entire mesh, so it must be clearly intentional:
// familiar eyes legitimately glow full-coverage at 2.6, but shogun_body's F_SELF_ILLUM
// + placeholder mask + 0.27 scale + white tint is the "bright white body" artifact, not
// a real glow. Real-masked self-illum keeps the low SI_SCALE_EPS gate (the mask
// localizes it).
// ponytail: single threshold between the two observed cases (0.27 artifact vs 2.6
// real); revisit if a hero ships a genuine full-coverage glow in (0.05, 1.0].
const PLACEHOLDER_SI_SCALE = 1.0;

// F6 NPR highlight is DISABLED pending visual validation. The additive-sphere
// approximation white-washes any material that authors real highlight coverage with a
// white tint: Yamato's shogun skin (shogun_body/dress) ships g_flHighlightCoverage1
// 0.35+, g_vHighlightTint1 [1,1,1], radius 256 centered on the torso, so the shader's
// up-to-0.5 additive of a white tint over that whole sphere reads as a "bright white
// mask" over the body. The earlier review wrongly assumed no hero authors nonzero
// coverage. highlightLayer + its gates are correct/tested; only the SHADER application
// is the unvalidated part. Flip to true to A/B a corrected highlight behind a visual
// gate. ponytail: dead-but-cheap; the layer code stays so re-enabling is one flag.
const F6_HIGHLIGHT_ENABLED = false;

/**
 * Resolve a material's self-illum scale into { value at t=0, peak, fn }.
 *
 * A dynamic g_flSelfIllumScale1 (inferno body uses 20*sin(10*time())+22) is the
 * authored animation envelope. The no-bloom preview keeps the static fallback as
 * brightness and uses the dynamic value only as a normalized pulse; driving the
 * full peak through a post-light additive pass washes the skin instead of matching
 * the localized in-game tattoo glow.
 */
function selfIllumScale(morphic: MorphicExtras): {
  value: number;
  peak: number;
  pulseValue: number;
  pulseFn: ((t: number) => number) | null;
} {
  const staticScale = firstNumber(morphic, ['g_flSelfIllumScale1', 'g_flSelfIllumScale'], 0);
  const dyn = morphic.dynamic_params?.g_flSelfIllumScale1;
  if (dyn) {
    if (dyn.decompiled && (dyn.attributes?.length ?? 0) === 0) {
      const pulse = compileScalarExpr(dyn.source);
      if (pulse) {
        const pk = peakScalar(pulse) || 1;
        const value = staticScale > 0 ? staticScale : pk;
        const pulseFn = (t: number) => Math.max(0, pulse(t)) / pk;
        return { value, peak: value, pulseValue: pulseFn(0), pulseFn };
      }
    }
    return { value: staticScale, peak: staticScale, pulseValue: 1, pulseFn: null };
  }
  return { value: staticScale, peak: staticScale, pulseValue: 1, pulseFn: null };
}

/**
 * Clone the GLTF base into an OWNED material, dodging both clone-up crashes (see
 * the module doc). The morphic extras object is shared by reference (immutable).
 */
function cloneOwned(base: THREE.Material, physical: boolean): THREE.MeshStandardMaterial {
  const clone = physical
    ? new THREE.MeshPhysicalMaterial()
    : new THREE.MeshStandardMaterial();

  // (b) Material.copy serializes userData via JSON; the resolvedTextures hold
  // THREE.Texture objects that throw on JSON.stringify. Clear it across the copy,
  // restore the base's reference after, and share the SAME object onto the clone.
  const baseUserData = base.userData;
  base.userData = {};
  try {
    if (physical && (base as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      // Physical source: keep the source's physical fields (ior, transmission,
      // sheen, clearcoat, physical maps). This path is safe because the source
      // actually has the physical-only fields MeshPhysicalMaterial.copy reads.
      THREE.MeshPhysicalMaterial.prototype.copy.call(clone, base);
    } else {
      // Standard source: route through MeshStandardMaterial.prototype.copy so a
      // physical clone does not read physical-only fields off the source and crash.
      THREE.MeshStandardMaterial.prototype.copy.call(clone, base);
    }
  } finally {
    base.userData = baseUserData;
  }
  if (physical) {
    // MeshStandardMaterial.copy resets defines to STANDARD only. Restore PHYSICAL
    // so three compiles the IOR/transmission path on the physical clone.
    clone.defines = { ...(clone.defines ?? {}), STANDARD: '', PHYSICAL: '' };
  }
  // Share the morphic extras BY REFERENCE (immutable; only material props are
  // written, never through userData.morphic). This also lets isNprMaterial /
  // getMorphic resolve off the clone if ever needed.
  clone.userData = baseUserData;
  return clone;
}

/**
 * Build the unified Deadlock NPR material for an NPR-eligible base material. The
 * caller is responsible for the isNprMaterial gate; this assumes morphic exists.
 *
 * NEVER mutates `base`. Returns the CSM + uniforms + owned textures + dispose.
 */
export function buildDeadlockMaterial(
  base: THREE.Material,
  tuning: NprTuning = DEFAULT_NPR_TUNING,
  tintOverride: THREE.Color | null = null
): DeadlockMaterialResult {
  const morphic = getMorphic(base)!;

  // --- Decide the clone class once, then clone. -----------------------------
  const physical = needsPhysical(morphic, base);
  const clone = cloneOwned(base, physical);
  const phys = clone as THREE.MeshPhysicalMaterial;
  // requiresVertexColors checks F_VERTEX_COLOR / F_PAINT_VERTEX_COLORS. The vpkmerge
  // GLB exporter writes COLOR_n on a SUPERSET of those flags (also the tint-mask
  // bools), so vertexColors=true here always implies the geometry shipped a COLOR_0
  // attribute. That matters: the shader USE_COLOR multiply reads vColor, and a
  // missing color attribute defaults to black (0,0,0), which would render the mesh
  // black. Do not gate vertexColors on material hints the exporter does NOT couple
  // to COLOR_n (the geometry-attribute presence is the real invariant here).
  if (requiresVertexColors(morphic) && 'vertexColors' in clone && !clone.vertexColors) {
    clone.vertexColors = true;
  }

  // Mask clones THIS build owns and disposes (the tint/rim mask handed to the
  // CSM, plus any mask assigned as alphaMap / emissiveMap / displacementMap on
  // the owned clone). The shared white fallback is NEVER disposed.
  const ownedTextures: THREE.Texture[] = [];
  function ownClone(tex: THREE.Texture): THREE.Texture {
    const c = tex.clone();
    c.needsUpdate = true;
    ownedTextures.push(c);
    return c;
  }

  // --- Material-state flags (ported from applySource2MaterialHints). --------
  const glass = isTrueGlassMaterial(morphic, base);
  const blendMode = resolveBlendMode(morphic);
  const alphaBlend = !glass && (blendMode === 'blend_zwrite' || blendMode === 'blend' || blendMode === 'additive');
  const additive = blendMode === 'additive';
  const unlit = flag(morphic, 'F_UNLIT');
  const sheen = flag(morphic, 'F_SHEEN');
  const backfaces = flag(morphic, 'F_RENDER_BACKFACES');
  // Non-NPR self-illum materials (familiar eyes) are wrapped to get the glow but
  // must skip cel/rim (uNprCel = 0); see isSelfIllumMaterial + NPR plan D15.
  const isNpr = flag(morphic, 'F_USE_NPR_LIGHTING');

  if (backfaces) clone.side = THREE.DoubleSide;

  if (glass) {
    // F_GLASS keeps the current treatment: transmission is for GLASS ONLY.
    clone.roughness = Math.min(clone.roughness ?? 1, 0.18);
    clone.metalness = Math.min(clone.metalness ?? 0, 0.05);
    clone.envMapIntensity = Math.max(clone.envMapIntensity ?? 1, 1.35);
    // needsPhysical() returns true on the SAME isTrueGlassMaterial predicate as
    // `glass`, so the clone is always a MeshPhysicalMaterial here. Guard the
    // physical-only writes anyway so the invariant is explicit at the write site
    // (matching how the legacy hints path was hardened) and a future change to the
    // clone-class decision can never write undefined physical fields onto a
    // standard clone.
    if (phys.isMeshPhysicalMaterial) {
      phys.transmission = Math.max(phys.transmission ?? 0, 0.85);
      phys.thickness = Math.max(phys.thickness ?? 0, 0.12);
      phys.ior = firstNumber(morphic, ['g_flIOR'], phys.ior ?? 1.5);
      phys.clearcoat = Math.max(phys.clearcoat ?? 0, 0.45);
      phys.clearcoatRoughness = Math.min(phys.clearcoatRoughness ?? 0.25, 0.18);
      const transmissionMap = glassTransmissionTexture(morphic);
      phys.transmissionMap = transmissionMap ? ownClone(transmissionMap) : null;
    }
  }

  if (alphaBlend) {
    // The goo: transparent alpha path, NEVER transmission (spike finding:
    // transmission makes the goo invisible; the green goo look comes from alpha).
    const dynamicAlpha = hasDynamicAlphaOverride(morphic);
    const alphaMask = dynamicAlpha ? null : translucentAlphaTexture(morphic);
    clone.transparent = true;
    // Translucent goo keeps depthWrite ON so it occludes the opaque interior
    // (Viscous's black gear / "bones"). depthWrite=false x-rays every interior
    // layer at once. Additive glow (below) still needs it off.
    clone.depthWrite = blendMode === 'blend_zwrite';
    if (dynamicAlpha) {
      clone.opacity = 1;
      clone.alphaMap = null;
      clone.alphaTest = 0;
    } else {
      const opacity = staticOpacityScale(morphic, 0.62);
      if (opacity !== null) clone.opacity = Math.min(clone.opacity, opacity);
    }
    if (alphaMask) {
      clone.alphaMap = ownClone(alphaMask);
      clone.alphaTest = Math.max(clone.alphaTest ?? 0, 0.01);
    }
    if (phys.isMeshPhysicalMaterial) {
      phys.transmission = 0;
      phys.transmissionMap = null;
    }
  }

  if (additive) {
    clone.blending = THREE.AdditiveBlending;
    clone.depthWrite = false;
  }

  // --- Self-illum: scale-FIRST gate (NPR plan D5/F2). ------------------------
  // The old mask-first gate left familiar's eyes and inferno's body dark (real
  // scale, placeholder/absent mask) yet could light viscous_body milky-white.
  // Drive the enable off the authored scale - or the PEAK of a dynamic scale
  // expression (inferno body pulses 0.5*sin(3*time())+0.5) - thresholded so
  // viscous_body's 0.02 stays OFF while viscous_head's 0.629 stays ON. The CSM
  // owns the glow; the clone's baked emissive is zeroed below (no stamp needed:
  // the clone is owned, not the base).
  const selfIllumMap = morphic.resolvedTextures?.g_tSelfIllumMask;
  const si = selfIllumScale(morphic);
  // A real mask localizes the glow, so a subtle scale is fine; a placeholder mask
  // glows the whole surface white, so require a clearly-intentional scale.
  // self_illum_valid is the exporter's ">4x4 real mask" call (mirrors the legacy
  // hints path, which the unified builder previously forgot to honor).
  const hasRealSelfIllumMask = morphic.self_illum_valid ?? isMeaningfulMask(selfIllumMap);
  const placeholderSelfIllumThreshold = additive ? SI_SCALE_EPS : PLACEHOLDER_SI_SCALE;
  const hasSelfIllum = si.peak > (hasRealSelfIllumMask ? SI_SCALE_EPS : placeholderSelfIllumThreshold);
  if (unlit && clone.emissive) {
    clone.emissive.copy(clone.color ?? new THREE.Color(1, 1, 1));
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 1, 1.2);
    clone.toneMapped = false;
  }

  // The CSM patch reads the GLB-baked emissive before its patch runs -> double
  // glow. Zero it last whenever the NPR path owns self-illum, even if F_UNLIT
  // also tried to populate emissive above. Null the map too so a later
  // intensity/tonemap change can't resurrect the baked emission (the CSM samples
  // its own uSelfIllumMap clone).
  if (hasSelfIllum) {
    clone.emissiveIntensity = 0;
    clone.emissiveMap = null;
  }

  if (sheen && phys.isMeshPhysicalMaterial) {
    phys.sheen = Math.max(phys.sheen ?? 0, 0.65);
    phys.sheenRoughness = firstNumber(
      morphic,
      ['TextureSheenRoughness1', 'g_flSheenRoughness'],
      phys.sheenRoughness ?? 0.45
    );
    phys.sheenColor.copy(
      vectorColor(morphic.vectors?.TextureSheenColor1 ?? morphic.vectors?.g_vSheenColorTint1, phys.sheenColor)
    );
  }

  const jitterMask = morphic.resolvedTextures?.g_tJitterMask;
  if (flag(morphic, 'F_JITTER_VERTICES') && isMeaningfulMask(jitterMask)) {
    // Jitter is approximated by a displacement map for v1 (harmless on low-poly).
    clone.displacementMap = ownClone(jitterMask);
    clone.displacementScale = Math.max(clone.displacementScale ?? 0, 0.01);
    clone.displacementBias = clone.displacementBias ?? 0;
  }

  // --- AO (NPR plan D4). The GLB binds g_tAmbientOcclusion as the glTF
  // occlusionTexture, which three maps to aoMap on TEXCOORD_0 (the UV Deadlock
  // authors AO on) and cloneOwned copies - no uv2 bug here. Two tweaks: honor the
  // secondary-UV flag, and tune intensity so the cel posterize does not flatten
  // cavities; clamp it on glass/goo where AO reads as dirt rather than occlusion.
  if (clone.aoMap) {
    clone.aoMap.channel = flag(morphic, 'g_bUseSecondaryUvForAmbientOcclusion') ? 1 : 0;
    clone.aoMapIntensity =
      glass || alphaBlend ? Math.min(clone.aoMapIntensity ?? 1, 0.5) : tuning.aoStrength;
  }

  clone.needsUpdate = true;

  // --- CSM uniforms (cel + rim + tint + self-illum scroll). ------------------
  // Default tint is white (identity); g_vColorTint1 is already baked into the
  // base color factor by vpkmerge, so it must NOT be re-applied here.
  const sharedTint = morphic.resolvedTextures?.g_tTintMaskRimLightMask;
  const tintMask = sharedTint ? ownClone(sharedTint) : null;
  const tintColor = tintOverride ?? new THREE.Color(1, 1, 1);
  const sharedTransmissive = morphic.resolvedTextures?.g_tNprTransmissiveColor;
  const transmissiveMap = isNpr && isMeaningfulMask(sharedTransmissive) ? ownClone(sharedTransmissive) : null;
  if (transmissiveMap) {
    transmissiveMap.colorSpace = THREE.SRGBColorSpace;
    transmissiveMap.needsUpdate = true;
  }

  // A real self-illum mask localizes + scrolls the glow; a genuine placeholder
  // (4x4) mask means "illuminate everywhere", so leave illumMap null and let the
  // uniform fall back to solid white (full coverage), e.g. familiar eyes. Bind the
  // mask whenever the exporter flagged it real (self_illum_valid, folded into
  // hasRealSelfIllumMask) and it resolved, NOT only when isMeaningfulMask passes:
  // Infernus's body mask IS the tattoo pattern, so it must localize to the tattoos
  // rather than glow the whole skin (incl. the face).
  let illumMap: THREE.Texture | null = null;
  if (hasSelfIllum && selfIllumMap && hasRealSelfIllumMask) {
    // Scroll wraps via fract(), so the sampler must repeat or the seam smears.
    illumMap = ownClone(selfIllumMap);
    illumMap.wrapS = THREE.RepeatWrapping;
    illumMap.wrapT = THREE.RepeatWrapping;
    illumMap.needsUpdate = true;
  }
  const shapeSelfIllumMask = !!illumMap && !!si.pulseFn;
  const siScroll =
    morphic.vectors?.g_vSelfIllumScrollSpeed1 ?? morphic.vectors?.g_vSelfIllumScrollSpeed;
  // Default tint WHITE: a scale-driven glow with albedoFactor 0 and no authored
  // tint should read as a white glow, not vanish (the old black default). Materials
  // that specify a tint (familiar eyes cyan) or use albedo (viscous_head green via
  // albedoFactor 1) still win.
  const siTint = vectorColor(
    morphic.vectors?.g_vSelfIllumTint1 ?? morphic.vectors?.g_vSelfIllumTint,
    new THREE.Color(1, 1, 1)
  );
  // Blend tint<->albedo per g_flSelfIllumAlbedoFactor1 (0 = tint, 1 = surface
  // albedo). The albedo side is sampled GPU-side from diffuseColor.
  //
  // Additive self-illum overlays (e.g. inferno_armglow / inferno_headglow) carry
  // their glow in the BASE COLOR (inferno_glow, a gradient on black) and bind only
  // a flat 4x4 placeholder self-illum mask. With the default factor 0 the glow is a
  // solid white tint gated by a white mask, so the whole overlay mesh floods - it
  // buries the crisp tattoos the opaque body draws from its own real emissive mask.
  // Default these to albedo: the gradient's black regions then add nothing under
  // additive blend, so the overlay only brightens where its texture is lit, matching
  // the in-game additive pass. An explicitly authored factor still wins.
  const siAlbedoFactorDefault = additive && !hasRealSelfIllumMask ? 1 : 0;
  const siAlbedoFactor = firstNumber(morphic, ['g_flSelfIllumAlbedoFactor1'], siAlbedoFactorDefault);
  const csb = albedoCsb(morphic);
  const detail = detailLayer(morphic);
  const highlight = F6_HIGHLIGHT_ENABLED && isNpr ? highlightLayer(morphic) : null;
  const detailMap = detail.texture ? ownClone(detail.texture) : null;
  if (detailMap) {
    detailMap.colorSpace = THREE.SRGBColorSpace;
    detailMap.wrapS = THREE.RepeatWrapping;
    detailMap.wrapT = THREE.RepeatWrapping;
    detailMap.needsUpdate = true;
  }
  const jitterMap = jitterMask && isMeaningfulMask(jitterMask) ? ownClone(jitterMask) : null;
  if (jitterMap) {
    jitterMap.wrapS = THREE.RepeatWrapping;
    jitterMap.wrapT = THREE.RepeatWrapping;
    jitterMap.needsUpdate = true;
  }
  const hasJitter = flag(morphic, 'F_JITTER_VERTICES');

  const uniforms: Record<string, THREE.IUniform> = {
    uKeyDir: { value: tuning.keyDir.clone() },
    uBands: { value: tuning.bands },
    uStepSharpness: { value: tuning.stepSharpness },
    uWrap: { value: tuning.wrap },
    uRimStrength: { value: tuning.rimStrength },
    uRimPower: { value: tuning.rimPower },
    uRimColor: { value: tuning.rimColor.clone() },
    uRimMaskDefault: { value: 1.0 },
    // Non-NPR materials apply self-illum at full strength (no cel to blend with).
    uNprStrength: { value: isNpr ? tuning.nprStrength : 1.0 },
    uCelV2: { value: 0.0 },
    uNprCel: { value: isNpr ? 1.0 : 0.0 },
    uTintColor: { value: tintColor },
    uTintRimMask: { value: tintMask ?? whiteFallback() },
    uHasTintMask: { value: tintMask ? 1.0 : 0.0 },
    uApplyVertexColor: { value: requiresVertexColors(morphic) ? 1.0 : 0.0 },
    uTime: { value: 0 },
    uSelfIllumMap: { value: illumMap ?? whiteFallback() },
    uHasSelfIllum: { value: hasSelfIllum ? 1.0 : 0.0 },
    uSelfIllumScroll: { value: new THREE.Vector2(siScroll?.[0] ?? 0, siScroll?.[1] ?? 0) },
    uSelfIllumTint: { value: siTint },
    uSelfIllumScale: { value: si.value },
    uSelfIllumPulse: { value: si.pulseValue },
    uSelfIllumAlbedoFactor: { value: siAlbedoFactor },
    uSelfIllumCap: { value: tuning.selfIllumCap },
    uSelfIllumSat: { value: tuning.selfIllumSat },
    uSelfIllumMaskShaping: { value: shapeSelfIllumMask ? 1.0 : 0.0 },
    uSelfIllumMaskLow: { value: tuning.selfIllumMaskLow },
    uSelfIllumMaskHigh: { value: tuning.selfIllumMaskHigh },
    uAlbedoCSB: { value: csb.vec },
    uHasAlbedoCSB: { value: csb.has },
    uNprTransmissiveColor: { value: transmissiveMap ?? whiteFallback() },
    uNprTransmissiveTint: { value: transmissiveTint(morphic) },
    uHasTransmissive: { value: transmissiveMap ? 1.0 : 0.0 },
    uTransStrength: { value: tuning.transStrength },
    uTransPower: { value: tuning.transPower },
    uDetailMap: { value: detailMap ?? whiteFallback() },
    uHasDetail: { value: detailMap ? 1.0 : 0.0 },
    uDetailTint: { value: detail.tint },
    uDetailBlendFactor: { value: detail.blendFactor },
    uDetailBlendMode: { value: detail.blendMode },
    uDetailUvOffset: { value: detail.uvOffset },
    uDetailUvScale: { value: detail.uvScale },
    uDetailUvRotation: { value: detail.uvRotation },
    uDetailUvChannel: { value: detail.uvChannel },
    uHasJitter: { value: hasJitter ? 1.0 : 0.0 },
    uJitterMap: { value: jitterMap ?? whiteFallback() },
    uHasJitterMask: { value: jitterMap ? 1.0 : 0.0 },
    uJitterSpeedA: { value: firstNumber(morphic, ['g_flJitterSpeedA1', 'g_flJitterSpeedA'], 0) },
    uJitterSpeedB: { value: firstNumber(morphic, ['g_flJitterSpeedB1', 'g_flJitterSpeedB'], 0) },
    uJitterStrength: { value: tuning.jitterStrength },
    uJitterFreqA: { value: vector3(morphic.vectors?.g_vJitterFrequenciesA1 ?? morphic.vectors?.g_vJitterFrequenciesA) },
    uJitterFreqB: { value: vector3(morphic.vectors?.g_vJitterFrequenciesB1 ?? morphic.vectors?.g_vJitterFrequenciesB) },
    uJitterAmpXA: { value: vector3(morphic.vectors?.g_vJitterAmplitudesXA1 ?? morphic.vectors?.g_vJitterAmplitudesXA) },
    uJitterAmpXB: { value: vector3(morphic.vectors?.g_vJitterAmplitudesXB1 ?? morphic.vectors?.g_vJitterAmplitudesXB) },
    uJitterAmpYA: { value: vector3(morphic.vectors?.g_vJitterAmplitudesYA1 ?? morphic.vectors?.g_vJitterAmplitudesYA) },
    uJitterAmpYB: { value: vector3(morphic.vectors?.g_vJitterAmplitudesYB1 ?? morphic.vectors?.g_vJitterAmplitudesYB) },
    uJitterAmpZA: { value: vector3(morphic.vectors?.g_vJitterAmplitudesZA1 ?? morphic.vectors?.g_vJitterAmplitudesZA) },
    uJitterAmpZB: { value: vector3(morphic.vectors?.g_vJitterAmplitudesZB1 ?? morphic.vectors?.g_vJitterAmplitudesZB) },
    uHasHighlight: { value: highlight?.has ?? 0.0 },
    uHighlightTint: { value: highlight?.tint ?? new THREE.Color(0, 0, 0) },
    uHighlightCoverage: { value: highlight?.coverage ?? 0.0 },
    uHighlightHardness: { value: highlight?.hardness ?? 0.0 },
    uHighlightBrightness: { value: highlight?.brightness ?? 0.0 },
    uHighlightInvert: { value: highlight?.invert ?? 0.0 },
    uHighlightPositionSource: { value: highlight?.positionSource ?? new THREE.Vector3(0, 0, 0) },
    uHighlightRadius: { value: highlight?.radius ?? 0.0 },
  };

  // Wrap the OWNED clone (never the live base) so CSM's in-place mutation lands
  // on the throwaway clone we dispose. No unwrapNprBase needed on this path.
  const csm = new CustomShaderMaterial({
    baseMaterial: clone as THREE.MeshPhysicalMaterial,
    vertexShader: NPR_VERTEX,
    fragmentShader: NPR_FRAGMENT,
    uniforms,
    patchMap: NPR_PATCH_MAP,
  });

  const dispose = () => {
    // CSM.dispose does NOT free its base material, so dispose the owned clone
    // separately, plus every mask clone this build created.
    csm.dispose();
    clone.dispose();
    ownedTextures.forEach((t) => t.dispose());
  };

  return {
    material: csm as unknown as THREE.Material,
    uniforms,
    ownedTextures,
    dispose,
    selfIllumPulseFn: si.pulseFn,
  };
}
