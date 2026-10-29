// Ported from ValveResourceFormat (MIT): Renderer/Shaders/particle_spritecard.frag.slang.
//
// GLSL 4.60 to GLSL ES 3.00 as in spritecardVertex.ts. Fog is left out: Deadlock leaves particles
// unfogged by default, and a scene without fog makes ApplyFog the identity. The scene depth the
// feathering reads is optional; without it the scene is infinitely far, as a cleared depth buffer
// reads. A ClampToBorder wrap, which WebGL lacks, is taken to its transparent black border here.

import { SPRITECARD_CHANNELS, SPRITECARD_COMMON } from './spritecardCommon';

export const SPRITECARD_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

#ifndef S_TEXTURE_LAYERS
#define S_TEXTURE_LAYERS 0
#endif
#ifndef S_MOTION_VECTORS
#define S_MOTION_VECTORS 0
#endif
#ifndef S_REFRACT
#define S_REFRACT 0
#endif

${SPRITECARD_COMMON}
${SPRITECARD_CHANNELS}

#define PARTICLE_OUTPUT_BLEND_MODE_ADD   1
#define PARTICLE_OUTPUT_BLEND_MODE_MOD2X 5
uniform int uBlendMode;

// Subtracted from the base texture's decoded frames under modulate-2x, in 1/256 steps per channel.
const vec3 MOD2X_BASE_BIAS = vec3(1.5, 2.5, 1.5) / 256.0;

// The share of the destination each output blend mode covers, per unit of alpha, indexed by mode.
const float OUTPUT_BLEND_MODE_ALPHA_FACTOR[7] = float[7](1.0, 0.0, -1.0, 0.5, -0.5, 1.0, 1.0);

#define MAX_TEXTURE_LAYERS (S_TEXTURE_LAYERS + 1)
uniform sampler2D uTexture;
#if S_TEXTURE_LAYERS > 0
uniform sampler2D uTextureLayer1;
#endif
#if S_TEXTURE_LAYERS > 1
uniform sampler2D uTextureLayer2;
#endif
#if S_TEXTURE_LAYERS > 2
uniform sampler2D uTextureLayer3;
#endif
#if S_TEXTURE_LAYERS > 3
uniform sampler2D uTextureLayer4;
#endif

// Whether each layer's texture reads a transparent black border past its edge on u and v
uniform vec2 uLayerBorder[MAX_TEXTURE_LAYERS];

// The anisotropy the shader filters a layer with itself, or 0 when the sampler's own applies
uniform float uLayerAnisotropy[MAX_TEXTURE_LAYERS];

#if S_MOTION_VECTORS
uniform sampler2D uMotionVectors;
uniform vec2 uMotionVectorScale;
centroid in vec4 vMotionVectorUvOut;
#endif

uniform float uOverbrightFactor;
uniform float uAddSelfAmount; // 1 + m_flAddSelfAmount
uniform float uDiffuseAmount; // m_flDiffuseAmount, scales the scene light
uniform float uSelfIllumAmount; // m_flSelfIllumAmount, added unlit
uniform float uDesaturation; // m_flDesaturation

// m_bBlendFramesSeq0 / m_bMaxLuminanceBlendingSequence0.
uniform bool uBlendFrames;
uniform bool uMaxLuminanceFrameBlend;

#define PARTICLE_LIGHTING_PER_PIXEL (-1)
uniform int uLightingMode;
uniform vec3 uSunColor;

uniform vec3 uHsvShift;

// The texture alpha is scaled by x and offset by y after the colour stages
uniform vec2 uAlphaRemap;

// A smoothstep over the texture alpha from x to y, skipped unless x is below y
uniform vec2 uEdgeSoftness;

uniform bool uOutline;
uniform vec4 uOutlineColor;
uniform vec4 uOutlineRanges;

// The feather fades over (min, max) as given. A minimum above the maximum inverts it.
uniform bool uFeathering;
uniform vec2 uFeatheringRange;
uniform float uFeatheringFilter;

// The opaque scene's depth under the fragment, when the host supplies it: a perspective depth texture
// of the viewport, with the camera's near and far planes in Source units
uniform bool uHasSceneDepth;
uniform sampler2D uSceneDepth;
uniform vec2 uSceneDepthNearFar;
uniform vec2 uViewportSize;

uniform bool uSaturateColor; // m_bSaturateColorPreAlphaBlend
uniform bool uUnsignedBlendAlpha; // spritecard shaders with texture layers
uniform bool uClampLayers; // each layer's composite is clamped to 1 as well as floored at 0

// The per particle alpha test.
uniform bool uAlphaReference;
uniform vec2 uAlphaReferenceOpaque;
uniform vec2 uAlphaReferenceSoftness;

#if S_REFRACT
uniform sampler2D g_tSceneColor;
uniform float uRefractAmount;
uniform int uRefractBlurRadius;
uniform bool uRefractBlurBox;
uniform bool uRefractSolid;
#endif

// Per-layer mask mode, blend mode and strength (m_nTextureChannels, m_nTextureBlendMode,
// m_flTextureBlend). Every entry below uLayerCount is written by the renderer each draw.
uniform int uLayerCount;
uniform int uLayerChannels[MAX_TEXTURE_LAYERS];
uniform int uLayerBlendMode[MAX_TEXTURE_LAYERS];
uniform float uLayerBlend[MAX_TEXTURE_LAYERS];

#define SPRITECARD_TEXTURE_ZOOM             1
#define SPRITECARD_TEXTURE_1D_COLOR_LOOKUP  2
#define SPRITECARD_TEXTURE_UVDISTORTION      3
#define SPRITECARD_TEXTURE_UVDISTORTION_ZOOM 4
uniform int uLayerEffectMode[MAX_TEXTURE_LAYERS];

uniform float uLayerDistortion[MAX_TEXTURE_LAYERS];
uniform float uLayerZoomScale[MAX_TEXTURE_LAYERS];

#define NO_FRAME_BLEND (-1.0)

// Indexed by mask mode: .x premultiplies the ramp's source colour by its alpha, .y switches the lookup
// to read alpha as the luma.
const vec2 MASK_RAMP_FLAGS[15] = vec2[15](
    vec2(1.0, 0.0), vec2(0.0, 0.0), vec2(0.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 0.0),
    vec2(1.0, 0.0), vec2(0.0, 0.0), vec2(0.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 0.0),
    vec2(1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 0.0), vec2(0.0, 0.0), vec2(0.0, 0.0));

centroid in vec2 vTexCoordOut;
centroid in vec2 vTexCoordNextFrameOut;
#if S_TEXTURE_LAYERS > 0
centroid in vec4 vLayerUvOut[S_TEXTURE_LAYERS];
#endif
flat in vec4 vLayerControlsOut[S_TEXTURE_LAYERS + 1];
in vec2 vFrameBlendOut;
flat in vec2 vAlphaReferenceOut;
centroid in float vUvWeightOut;
centroid in vec2 vCardUvOut;
in vec4 vColor;
in vec3 vFragPosition;
in vec3 vLightOut;

layout(location = 0) out vec4 fragColor;

// How much of a bilinear tap at uv the texels inside 0 to 1 make up, on the axes that read a border
float BorderCoverage(vec2 uv, vec2 size, vec2 border)
{
    vec2 inside = clamp(vec2(0.5) + (min(uv, vec2(1.0) - uv) * size), 0.0, 1.0);
    vec2 coverage = mix(vec2(1.0), inside, border);

    return coverage.x * coverage.y;
}

vec4 SampleBordered(sampler2D layerTexture, vec2 uv, vec2 border)
{
    vec4 texel = texture(layerTexture, uv);

    if (border == vec2(0.0))
    {
        return texel;
    }

    return texel * BorderCoverage(uv, vec2(textureSize(layerTexture, 0)), border);
}

// GLSL cannot return an opaque texture, so the per-layer choice happens at the fetch itself.
vec4 SampleLayer(int layer, vec2 uv)
{
    switch (layer)
    {
#if S_TEXTURE_LAYERS > 0
        case 1: return SampleBordered(uTextureLayer1, uv, uLayerBorder[1]);
#endif
#if S_TEXTURE_LAYERS > 1
        case 2: return SampleBordered(uTextureLayer2, uv, uLayerBorder[2]);
#endif
#if S_TEXTURE_LAYERS > 2
        case 3: return SampleBordered(uTextureLayer3, uv, uLayerBorder[3]);
#endif
#if S_TEXTURE_LAYERS > 3
        case 4: return SampleBordered(uTextureLayer4, uv, uLayerBorder[4]);
#endif
    }

    return SampleBordered(uTexture, uv, uLayerBorder[0]);
}

// The top level of a layer's texture at uv, and the texture's size
vec4 SampleLayerLod0(int layer, vec2 uv)
{
    switch (layer)
    {
#if S_TEXTURE_LAYERS > 0
        case 1: return textureLod(uTextureLayer1, uv, 0.0);
#endif
#if S_TEXTURE_LAYERS > 1
        case 2: return textureLod(uTextureLayer2, uv, 0.0);
#endif
#if S_TEXTURE_LAYERS > 2
        case 3: return textureLod(uTextureLayer3, uv, 0.0);
#endif
#if S_TEXTURE_LAYERS > 3
        case 4: return textureLod(uTextureLayer4, uv, 0.0);
#endif
    }

    return textureLod(uTexture, uv, 0.0);
}

ivec2 LayerSize(int layer)
{
    switch (layer)
    {
#if S_TEXTURE_LAYERS > 0
        case 1: return textureSize(uTextureLayer1, 0);
#endif
#if S_TEXTURE_LAYERS > 1
        case 2: return textureSize(uTextureLayer2, 0);
#endif
#if S_TEXTURE_LAYERS > 2
        case 3: return textureSize(uTextureLayer3, 0);
#endif
#if S_TEXTURE_LAYERS > 3
        case 4: return textureSize(uTextureLayer4, 0);
#endif
    }

    return textureSize(uTexture, 0);
}

// Each layer's entry is read by a constant index.
vec4 LayerControls(int layer)
{
    switch (layer)
    {
#if S_TEXTURE_LAYERS > 0
        case 1: return vLayerControlsOut[1];
#endif
#if S_TEXTURE_LAYERS > 1
        case 2: return vLayerControlsOut[2];
#endif
#if S_TEXTURE_LAYERS > 2
        case 3: return vLayerControlsOut[3];
#endif
#if S_TEXTURE_LAYERS > 3
        case 4: return vLayerControlsOut[4];
#endif
    }

    return vLayerControlsOut[0];
}

// Two taps of a layer's own texture, at opposite ends of a zoom sweep about the card centre, eased and
// cross-faded. The sweep is what animates; a single tap would only ever be a fixed magnification.
vec4 ZoomSample(int layer, vec2 uv, float rate)
{
    float phase = fract(rate);
    float eased = phase / ((-0.4 * (1.0 - phase)) + 1.0);

    vec2 centred = uv - vec2(0.5);
    vec4 wide = SampleLayer(layer, (centred * mix(4.0, 1.0, eased)) + vec2(0.5));
    vec4 tight = SampleLayer(layer, (centred * mix(1.0, 0.0625, eased)) + vec2(0.5));

    return mix(tight, wide, eased * eased);
}

// A distortion layer never shows its own texture: its red and green drive an offset that the layer
// beneath it is re-sampled through, so what reaches the accumulator is the layer below, warped.
vec4 DistortPrevious(int previousLayer, vec4 source, vec2 previousUv, float strength)
{
    vec2 offset = (SrgbLinearToGamma(source.rgb).xy - vec2(0.5)) * 2.0;

    return SampleLayer(previousLayer, previousUv - (offset * (strength * 0.125 * source.a)));
}

// A clamping layer is sampled through VRF's clamp sampler, which filters anisotropically. ANGLE gives a
// texture of one level no anisotropy, so for those the footprint is filtered here as the GL
// specification describes it: N = min(ceil(Pmax / Pmin), max anisotropy) taps along the major axis.
vec4 SampleAnisotropic(int layer, vec2 uv)
{
    vec2 size = vec2(LayerSize(layer));
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    float px = length(dx * size);
    float py = length(dy * size);
    float pMax = max(px, py);
    float pMin = min(px, py);
    float taps = min(ceil(pMax / max(pMin, 1e-6)), uLayerAnisotropy[layer]);

    if (taps <= 1.0)
    {
        return SampleLayer(layer, uv);
    }

    vec2 major = px >= py ? dx : dy;
    vec4 sum = vec4(0.0);

    for (int i = 0; i < 16; ++i)
    {
        if (float(i) < taps)
        {
            sum += SampleLayerLod0(layer, uv + (major * (((float(i) + 0.5) / taps) - 0.5)));
        }
    }

    return sum / taps;
}

// A 1D ramp, looked up by the luminance of whatever is beneath this layer. The lookup runs in gamma
// space. The layer's controls place the luminance across the ramp, and alone pick the row, so the row
// is the same over the whole particle.
vec4 SampleGradientRamp(int layer, vec4 previous, int maskMode, vec4 controls)
{
    vec2 flags = MASK_RAMP_FLAGS[maskMode];

    vec4 source = mix(mix(vec4(previous.rgb * previous.aaa, 1.0), previous, flags.x),
                      previous.aaaa, flags.y);

    float luma = GetLuma(SrgbLinearToGamma(source.rgb));
    vec2 rampUv = vec2((luma + controls.x) * controls.z, controls.y);
    vec4 ramp = uLayerAnisotropy[layer] > 1.0 ? SampleAnisotropic(layer, rampUv) : SampleLayer(layer, rampUv);

    // With alpha as the luma the ramp also supplies the alpha; otherwise the layer below keeps its own.
    return mix(vec4(ramp.rgb, previous.a), vec4(ramp.rgb, dot(ramp.rgb, LUMA_601)), flags.y);
}

// Shifts the hue and scales saturation and value, going through HSV and back.
vec3 ApplyHsvShift(vec3 sourceColor)
{
    // The conversion runs on a normalized copy and the magnitude is put back afterwards, so a colour
    // brighter than 1 keeps its overbright rather than being crushed to the top of the value axis.
    float overbright = max(max3(sourceColor), 1.0);
    vec3 rgb = saturate(sourceColor / overbright);

    float valueMax = max3(rgb);
    float chroma = valueMax - min3(rgb);

    vec3 hsv = vec3(0.0, 0.0, valueMax);

    if (chroma != 0.0)
    {
        vec3 distance = (vec3(valueMax) - rgb) / vec3(chroma);
        vec3 delta = distance - distance.zxy;

        // Which sixth of the hue wheel the largest channel puts us in.
        if (rgb.r >= valueMax)      { hsv = vec3(delta.z,       chroma / valueMax, valueMax); }
        else if (rgb.g >= valueMax) { hsv = vec3(delta.x + 2.0, chroma / valueMax, valueMax); }
        else                        { hsv = vec3(delta.y + 4.0, chroma / valueMax, valueMax); }

        hsv.x = fract(hsv.x * (1.0 / 6.0));
    }

    float hue = fract(hsv.x + uHsvShift.x);
    vec2 satVal = saturate(hsv.yz * uHsvShift.yz);

    if (satVal.x == 0.0)
    {
        return vec3(satVal.y) * overbright;
    }

    float sector = hue * 6.0;
    float index = floor(sector);
    float f = sector - index;

    float p = satVal.y * (1.0 - satVal.x);
    float q = satVal.y * (1.0 - (satVal.x * f));
    float t = satVal.y * (1.0 - (satVal.x * (1.0 - f)));

    if (index == 0.0) { return vec3(satVal.y, t, p) * overbright; }
    if (index == 1.0) { return vec3(q, satVal.y, p) * overbright; }
    if (index == 2.0) { return vec3(p, satVal.y, t) * overbright; }
    if (index == 3.0) { return vec3(p, q, satVal.y) * overbright; }
    if (index == 4.0) { return vec3(t, p, satVal.y) * overbright; }

    return vec3(satVal.y, p, q) * overbright;
}

// Each later layer's coordinates are read by a constant index, as D3D cannot index varyings
vec4 LayerUvs(int layer)
{
    vec4 uvs = vec4(vTexCoordOut, vTexCoordNextFrameOut);

    switch (layer)
    {
#if S_TEXTURE_LAYERS > 0
        case 1: uvs = vLayerUvOut[0]; break;
#endif
#if S_TEXTURE_LAYERS > 1
        case 2: uvs = vLayerUvOut[1]; break;
#endif
#if S_TEXTURE_LAYERS > 2
        case 3: uvs = vLayerUvOut[2]; break;
#endif
#if S_TEXTURE_LAYERS > 3
        case 4: uvs = vLayerUvOut[3]; break;
#endif
    }

    uvs.xz /= vUvWeightOut;

    return uvs;
}

// How far between its two sheet frames a layer has crossed. Only the first two layers cross-fade, each by its
// own blend; later layers always show their current frame.
float LayerFrameBlend(int layer)
{
    if (layer == 0)
    {
        return vFrameBlendOut.x;
    }

    if (layer == 1)
    {
        return vFrameBlendOut.y;
    }

    return NO_FRAME_BLEND;
}

#if S_MOTION_VECTORS
// The motion vectors' push at a coordinate.
vec2 SampleFlow(vec2 uv)
{
    return ((texture(uMotionVectors, uv).yw * 2.0) - vec2(1.0)) * uMotionVectorScale;
}
#endif

#if S_REFRACT
// The scene at the fragment, displaced by the texel's red and green signed about a half, as far as its alpha
// and the refract amount take it, then averaged over a square of pixels with gaussian or equal weights.
vec3 SampleRefraction(vec4 texel)
{
    vec2 pixelSize = 1.0 / vec2(textureSize(g_tSceneColor, 0));
    vec2 uv = (gl_FragCoord.xy * pixelSize) - (((texel.xy - vec2(0.5)) * 2.0) * (uRefractAmount * texel.a));

    if (uRefractBlurRadius <= 0)
    {
        return textureLod(g_tSceneColor, uv, 0.0).rgb;
    }

    float radius = float(uRefractBlurRadius);
    float sigma = radius * 0.5;
    vec3 sum = vec3(0.0);
    float weights = 0.0;

    for (int y = -4; y <= 4; ++y)
    {
        for (int x = -4; x <= 4; ++x)
        {
            if (abs(x) > uRefractBlurRadius || abs(y) > uRefractBlurRadius)
            {
                continue;
            }

            vec2 offset = vec2(x, y);
            vec2 normalized = offset / radius;
            float weight = uRefractBlurBox ? 1.0 : exp(-dot(normalized, normalized) / (2.0 * sigma * sigma));

            sum += textureLod(g_tSceneColor, uv + (offset * pixelSize), 0.0).rgb * weight;
            weights += weight;
        }
    }

    return sum / weights;
}
#endif

// 0 below the edge and 1 above it, rising over width when that is positive.
float RampAcross(float distance, float width)
{
    return width > 0.0 ? saturate(distance / width) : float(distance > 0.0);
}

// The alpha of a card that passes where its texture alpha lies above the particle's threshold, and below the
// threshold plus the window.
float AlphaReference(float textureAlpha, float vertexAlpha)
{
    float threshold = vAlphaReferenceOut.x;
    float window = vAlphaReferenceOut.y;

    float band = min(
        RampAcross(textureAlpha - threshold, uAlphaReferenceSoftness.y),
        RampAcross(threshold + window - textureAlpha, uAlphaReferenceSoftness.x));

    return max(uAlphaReferenceOpaque.x, textureAlpha) * band * max(uAlphaReferenceOpaque.y, vertexAlpha);
}

// The opaque scene's position under the fragment, along the ray from the camera through it
vec3 SceneWorldPosition(vec3 toFragment)
{
    float depth = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).x;
    float near = uSceneDepthNearFar.x;
    float far = uSceneDepthNearFar.y;

    // Perspective depth back to the distance along the view axis
    float viewDistance = (near * far) / ((far - near) * depth - far);
    float perspectiveCorrection = dot(g_vCameraDirWs, toFragment);

    return g_vCameraPositionWs + (toFragment * (-viewDistance / perspectiveCorrection));
}

// Folds layer i into the accumulator. Called once per layer the combo has, with a literal index, so
// every texture the layer samples is known when the shader compiles and every sample keeps its
// implicit gradients: D3D cannot take them in a loop, and miscompiles a sampler chosen at run time.
void FoldLayer(int i, inout vec4 accum, inout vec2 previousUv, inout int previousLayer, vec2 flow, vec2 flowNext)
{
    int effectMode = uLayerEffectMode[i];

    // The first two layers cross-fade between their own sheet's current and next frame rects; layers
    // whose rects are constant (one-frame sequences, plain textures) mix two identical samples.
    vec4 uvs = LayerUvs(i);
    vec2 layerUv = uvs.xy;
    vec2 layerUvNext = uvs.zw;
    float frameBlend = LayerFrameBlend(i);

    // Only the first two layers warp, each as far as its own frame blend, and a layer without sheet
    // frames stays put.
    if (i < 2 && frameBlend > NO_FRAME_BLEND)
    {
        layerUv -= flow * frameBlend;
        layerUvNext += flowNext * (1.0 - frameBlend);
    }

    frameBlend = max(frameBlend, 0.0);

    // Modulate-2x pulls both base frames down by a fixed offset before anything else reads them;
    // re-samples for zoom or distortion keep the raw texture.
    vec3 mod2xBias = (i == 0 && uBlendMode == PARTICLE_OUTPUT_BLEND_MODE_MOD2X) ? MOD2X_BASE_BIAS : vec3(0.0);

    vec4 layer = SampleLayer(i, layerUv);
    layer.rgb -= mod2xBias;

    if (uBlendFrames && i < 2)
    {
        vec4 nextFrame = SampleLayer(i, layerUvNext);
        nextFrame.rgb -= mod2xBias;

        if (i == 0 && uMaxLuminanceFrameBlend)
        {
            // Weighting each frame by the square root of its luminance keeps the brighter one
            // dominant through the cross-fade, so a spark does not dim as it crosses a frame.
            float weight = (1.0 - frameBlend) * sqrt(max(0.001, GetLuma(layer.rgb)));
            float nextWeight = frameBlend * sqrt(max(0.001, GetLuma(nextFrame.rgb)));
            layer = ((layer * weight) + (nextFrame * nextWeight)) / (weight + nextWeight);
        }
        else
        {
            layer = mix(layer, nextFrame, frameBlend);
        }
    }

    vec4 controls = LayerControls(i);
    bool distorts = effectMode == SPRITECARD_TEXTURE_UVDISTORTION || effectMode == SPRITECARD_TEXTURE_UVDISTORTION_ZOOM;

    if (effectMode == SPRITECARD_TEXTURE_ZOOM || effectMode == SPRITECARD_TEXTURE_UVDISTORTION_ZOOM)
    {
        layer = ZoomSample(i, layerUv, uLayerZoomScale[i] * controls.x);
    }

    if (distorts)
    {
        layer = DistortPrevious(previousLayer, layer, previousUv, uLayerDistortion[i] * controls.y);
    }

    previousUv = layerUv;
    previousLayer = i;

    int maskMode = uLayerChannels[i];

    // A distortion layer's weight went into its distortion, so its blend is left as it is
    float blendWeight = distorts ? 1.0 : controls.y;

    if (effectMode == SPRITECARD_TEXTURE_1D_COLOR_LOOKUP)
    {
        // Effects read the layer's own sample on layer 0 and the accumulator on later layers, which
        // keeps this a special case rather than something that folds away.
        layer = SampleGradientRamp(i, i == 0 ? layer : accum, maskMode, controls);
        blendWeight = controls.w;
    }

    int blendMode = uLayerBlendMode[i];
    float sub = float(blendMode == SPRITECARD_TEXTURE_BLEND_SUBTRACT);

    vec4 masked = ApplyChannelMask(accum, layer, maskMode, sub);
    vec4 blended = ApplyLayerBlend(accum, masked, blendMode);

    // m_flTextureBlend fades the layer's contribution back toward what was already there.
    vec4 faded = mix(accum, blended, uLayerBlend[i] * blendWeight);
    accum = uClampLayers ? saturate(faded) : max(faded, vec4(0.0));
}

void main(void) {
    // Each layer is folded into an accumulator seeded to white. Layer 0 is the base texture, so with one
    // layer and the default MULTIPLY this collapses to a straight sample.
    vec4 accum = vec4(1.0);
    vec2 previousUv = LayerUvs(0).xy;
    int previousLayer = 0;

    // The push of the current frame toward the next, and of the next back toward the current
    vec2 flow = vec2(0.0);
    vec2 flowNext = vec2(0.0);

#if S_MOTION_VECTORS
    if (uBlendFrames)
    {
        flow = SampleFlow(vMotionVectorUvOut.xy);
        flowNext = SampleFlow(vMotionVectorUvOut.zw);
    }
#endif

    FoldLayer(0, accum, previousUv, previousLayer, flow, flowNext);
#if S_TEXTURE_LAYERS > 0
    FoldLayer(1, accum, previousUv, previousLayer, flow, flowNext);
#endif
#if S_TEXTURE_LAYERS > 1
    FoldLayer(2, accum, previousUv, previousLayer, flow, flowNext);
#endif
#if S_TEXTURE_LAYERS > 2
    FoldLayer(3, accum, previousUv, previousLayer, flow, flowNext);
#endif
#if S_TEXTURE_LAYERS > 3
    FoldLayer(4, accum, previousUv, previousLayer, flow, flowNext);
#endif

    vec4 color = accum;

#if S_REFRACT
    color.rgb = SampleRefraction(accum);
#endif

    vec3 finalColor = vColor.rgb * color.rgb;

    if (uHsvShift != vec3(0.0, 1.0, 1.0))
    {
        finalColor = ApplyHsvShift(finalColor);
    }

    // Both the soft edge and the outline band read the raw texture alpha; only the soft edge's result is
    // carried forward, so an outline lands in the same place whether or not soft edges are on.
    float rawAlpha = color.a;
    float alpha = rawAlpha;

    if (!uAlphaReference && uEdgeSoftness.x < uEdgeSoftness.y)
    {
        alpha = smoothstep(uEdgeSoftness.x, uEdgeSoftness.y, rawAlpha);
    }

    // Overlay the outline colour across its alpha band. Solid between Start1 and End0, feathered outside.
    if (!uAlphaReference && uOutline && rawAlpha >= uOutlineRanges.x && rawAlpha <= uOutlineRanges.w)
    {
        float outlineRamp = rawAlpha <= uOutlineRanges.z
            ? smoothstep(uOutlineRanges.x, uOutlineRanges.z, rawAlpha)
            : 1.0 - smoothstep(uOutlineRanges.y, uOutlineRanges.w, rawAlpha);

        finalColor = mix(finalColor, uOutlineColor.rgb, outlineRamp);
        alpha = mix(alpha, uOutlineColor.a, outlineRamp);
    }

    // Pulls the whole card toward its own luminance, after the outline so the overlay desaturates with
    // everything else.
    finalColor = mix(finalColor, vec3(GetLuma(finalColor)), uDesaturation);

    // The offset is not scaled, so only a remap whose zero point is 0 sends it to 0. The result is only
    // saturated when frames blend.
    alpha = alpha * uAlphaRemap.x + uAlphaRemap.y;

    if (uBlendFrames)
    {
        alpha = saturate(alpha);
    }

    alpha = uAlphaReference ? AlphaReference(alpha, vColor.a) : alpha * vColor.a;

    if (uFeathering && uHasSceneDepth)
    {
        vec3 toFragment = vFragPosition - g_vCameraPositionWs;
        vec3 scenePosition = SceneWorldPosition(toFragment);

        float spread = 1.0 - alpha;
        float halfWidening = 1.0;

        if (!uBlendFrames)
        {
            spread += length((vCardUvOut * 2.0) - vec2(1.0));
            halfWidening = 0.5;
        }

        float offset = spread * (uFeatheringRange.y * uFeatheringFilter * halfWidening);

        float pastMin = distance(vFragPosition, scenePosition) - offset - uFeatheringRange.x;
        float range = uFeatheringRange.y - uFeatheringRange.x;

        // An empty range is a hard cut at the minimum distance
        alpha *= range != 0.0 ? saturate(pastMin / range) : float(pastMin > 0.0);
    }

#if S_REFRACT
    if (uRefractSolid)
    {
        alpha = saturate(alpha * 128.0);
    }
#endif

    float blendAlphaFactor = OUTPUT_BLEND_MODE_ALPHA_FACTOR[clamp(uBlendMode, 0, 6)];

    if (uBlendMode == PARTICLE_OUTPUT_BLEND_MODE_MOD2X)
    {
        // Modulate-2x is its own output, not an additive one: 0.5 is the neutral that leaves the
        // destination untouched, and the vertex colour weights each channel away from grey rather than
        // scaling it. The lighting and fog stages are skipped on this path.
        vec3 mod2xColor = mix(vec3(0.5), mix(vec3(0.5), finalColor * uOverbrightFactor, vColor.rgb), vec3(alpha));

        fragColor = vec4(saturate(mod2xColor), alpha);
    }
    else
    {
        vec3 litColor = finalColor * uSelfIllumAmount;

        if (uDiffuseAmount != 0.0)
        {
            vec3 light = vLightOut;

            // TODO: Whether per pixel lighting tessellates the card rather than lighting its fragments is not
            // known, so it is lit per fragment
            if (uLightingMode == PARTICLE_LIGHTING_PER_PIXEL)
            {
                light = CalculateParticleLighting(uSunColor);
            }

            litColor += finalColor * light * uDiffuseAmount;
        }

        finalColor = uOverbrightFactor * litColor;

        // m_flAddSelfAmount arrives as 1 + amount; over an alpha blend the extra term lays the
        // particle's own colour additively on top.
        finalColor *= uAddSelfAmount;

        if (uSaturateColor)
        {
            finalColor = saturate(finalColor);
        }

        fragColor = uUnsignedBlendAlpha
            ? vec4(finalColor * mix(alpha, 1.0, saturate(-blendAlphaFactor)), alpha * abs(blendAlphaFactor))
            : vec4(finalColor * alpha, alpha * blendAlphaFactor);
    }
}
`;
