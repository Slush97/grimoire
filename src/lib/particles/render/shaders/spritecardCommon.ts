// Ported from ValveResourceFormat (MIT): Renderer/Shaders/common/utils.slang,
// common/spritecard_channels.slang and common/lighting.particle.slang (the part without light
// probes), shared by the spritecard vertex and fragment shaders.

export const SPRITECARD_COMMON = /* glsl */ `
// The view constants the shaders read, in Source space
uniform vec3 g_vCameraPositionWs;
uniform vec3 g_vCameraDirWs;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }

float min3(vec3 v) { return min(min(v.x, v.y), v.z); }
float max3(vec3 v) { return max(max(v.x, v.y), v.z); }

// BT.709-1, same as Valve
const vec3 LumaWeights = vec3(0.2125, 0.7154, 0.0721);

float GetLuma(vec3 color) { return dot(color, LumaWeights); }

vec3 SrgbGammaToLinear(vec3 color)
{
    vec3 vLinearSegment = color / vec3(12.92);
    vec3 vExpSegment = pow((color / vec3(1.055)) + vec3(0.0521327), vec3(2.4));

    const float cap = 0.04045;
    float select0 = color.r > cap ? vExpSegment.r : vLinearSegment.r;
    float select1 = color.g > cap ? vExpSegment.g : vLinearSegment.g;
    float select2 = color.b > cap ? vExpSegment.b : vLinearSegment.b;

    return vec3(select0, select1, select2);
}

vec3 SrgbLinearToGamma(vec3 vLinearColor)
{
    vec3 vLinearSegment = vLinearColor.rgb * 12.92;
    vec3 vExpSegment = (1.055 * pow(vLinearColor.rgb, vec3(1.0 / 2.4))) - 0.055;

    return vec3((vLinearColor.r <= 0.0031308) ? vLinearSegment.r : vExpSegment.r,
                (vLinearColor.g <= 0.0031308) ? vLinearSegment.g : vExpSegment.g,
                (vLinearColor.b <= 0.0031308) ? vLinearSegment.b : vExpSegment.b);
}

// CalculateParticleLighting in a scene without light probes: ambient 1 and the unshadowed sun,
// which a directionality of 0 takes whole whatever the normal
vec3 CalculateParticleLighting(vec3 sunColor)
{
    return vec3(1.0) + sunColor;
}
`;

export const SPRITECARD_CHANNELS = /* glsl */ `
const vec3 LUMA_601 = vec3(0.299, 0.587, 0.114);

#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGB            0
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA           1
#define SPRITECARD_TEXTURE_CHANNEL_MIX_A              2
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_A          3
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_ALPHAMASK  4
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_RGBMASK    5
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA  6
#define SPRITECARD_TEXTURE_CHANNEL_MIX_A_RGBALPHA     7
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_A_RGBALPHA 8
#define SPRITECARD_TEXTURE_CHANNEL_MIX_R              9
#define SPRITECARD_TEXTURE_CHANNEL_MIX_G              10
#define SPRITECARD_TEXTURE_CHANNEL_MIX_B              11
#define SPRITECARD_TEXTURE_CHANNEL_MIX_RALPHA         12
#define SPRITECARD_TEXTURE_CHANNEL_MIX_GALPHA         13
#define SPRITECARD_TEXTURE_CHANNEL_MIX_BALPHA         14

#define SPRITECARD_TEXTURE_BLEND_MULTIPLY  0
#define SPRITECARD_TEXTURE_BLEND_MOD2X     1
#define SPRITECARD_TEXTURE_BLEND_REPLACE   2
#define SPRITECARD_TEXTURE_BLEND_ADD       3
#define SPRITECARD_TEXTURE_BLEND_SUBTRACT  4
#define SPRITECARD_TEXTURE_BLEND_AVERAGE   5
#define SPRITECARD_TEXTURE_BLEND_LUMINANCE 6

// SUBTRACT zeroes the accumulator's contribution in pass-through modes, so subtracting a
// colour-only layer does not also subtract alpha it never supplied.
vec4 ApplyChannelMask(vec4 accum, vec4 layer, int maskMode, float sub)
{
    switch (maskMode)
    {
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RGB:
            return vec4(layer.rgb, mix(accum.a, 0.0, sub));
        case SPRITECARD_TEXTURE_CHANNEL_MIX_A:
            return vec4(mix(accum.rgb, vec3(0.0), sub), layer.a);
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_A:
            return vec4(layer.rgb, accum.a * layer.a);
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_ALPHAMASK:
            return vec4(mix(accum.rgb, layer.rgb, layer.a), accum.a);
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_RGBMASK:
            return vec4(mix(accum.rgb, layer.rgb, dot(layer.rgb, LUMA_601)), accum.a);
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA_RGBALPHA:
            return vec4(layer.rgb, dot(layer.rgb, LUMA_601));
        case SPRITECARD_TEXTURE_CHANNEL_MIX_A_RGBALPHA:
            return vec4(mix(accum.rgb, vec3(0.0), sub), dot(layer.rgb, LUMA_601));
        // The accumulator keeps its colour here and only lends its alpha to the layer's luminance, unlike
        // the RGB_A and RGBA_RGBALPHA modes above which take the layer's colour.
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RGB_A_RGBALPHA:
            return vec4(accum.rgb, accum.a * dot(layer.rgb, LUMA_601));

        // The single-channel modes keep their own channel and drop the rest under SUBTRACT.
        case SPRITECARD_TEXTURE_CHANNEL_MIX_R:
            return vec4(layer.r, mix(vec3(layer.r, layer.r, accum.a), vec3(0.0), sub));
        case SPRITECARD_TEXTURE_CHANNEL_MIX_G:
            return vec4(mix(layer.g, 0.0, sub), layer.g, mix(vec2(layer.g, accum.a), vec2(0.0), sub));
        case SPRITECARD_TEXTURE_CHANNEL_MIX_B:
            return vec4(mix(vec2(layer.b), vec2(0.0), sub), layer.b, mix(accum.a, 0.0, sub));

        // ...and the *ALPHA variants broadcast their channel into the alpha as well.
        case SPRITECARD_TEXTURE_CHANNEL_MIX_RALPHA:
            return vec4(layer.r, mix(vec2(layer.r), vec2(0.0), sub), layer.r);
        case SPRITECARD_TEXTURE_CHANNEL_MIX_GALPHA:
            return vec4(mix(layer.g, 0.0, sub), layer.g, mix(layer.g, 0.0, sub), layer.g);
        case SPRITECARD_TEXTURE_CHANNEL_MIX_BALPHA:
            return vec4(mix(vec2(layer.b), vec2(0.0), sub), layer.b, layer.b);
    }

    return layer; // MIX_RGBA, and anything unrecognised
}

vec4 ApplyLayerBlend(vec4 accum, vec4 masked, int blendMode)
{
    switch (blendMode)
    {
        case SPRITECARD_TEXTURE_BLEND_MOD2X:      return accum * masked * 2.0;
        case SPRITECARD_TEXTURE_BLEND_REPLACE:    return masked;
        case SPRITECARD_TEXTURE_BLEND_ADD:        return accum + masked;
        case SPRITECARD_TEXTURE_BLEND_SUBTRACT:   return accum - masked;
        case SPRITECARD_TEXTURE_BLEND_AVERAGE:    return (accum + masked) * 0.5;
        case SPRITECARD_TEXTURE_BLEND_LUMINANCE:  return vec4(accum.rgb * GetLuma(masked.rgb), masked.a);
    }

    return accum * masked; // MULTIPLY, and anything unrecognised
}
`;
