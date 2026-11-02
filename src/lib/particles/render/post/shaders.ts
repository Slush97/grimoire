// Ported from ValveResourceFormat (MIT): Renderer/Shaders/downsample_bloomthreshold.frag.slang,
// gaussian_bloom_blur.frag.slang and post_processing.frag.slang, to GLSL ES 3.00.
//
// The passes Deadlock takes: the threshold downsample without the exposed threshold, and the box
// upsample without the tent filter. The upsample's dual source blend (one, src1 colour) takes a
// constant blend colour instead, which is what its second output always is.

export const FULLSCREEN_VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

float max3(vec3 v) { return max(max(v.x, v.y), v.z); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }

vec3 SrgbLinearToGamma(vec3 vLinearColor)
{
    vec3 vLinearSegment = vLinearColor.rgb * 12.92;
    vec3 vExpSegment = (1.055 * pow(vLinearColor.rgb, vec3(1.0 / 2.4))) - 0.055;

    return vec3((vLinearColor.r <= 0.0031308) ? vLinearSegment.r : vExpSegment.r,
                (vLinearColor.g <= 0.0031308) ? vLinearSegment.g : vExpSegment.g,
                (vLinearColor.b <= 0.0031308) ? vLinearSegment.b : vExpSegment.b);
}

layout(location = 0) out vec4 outputColor;
`;

export const BLOOM_THRESHOLD_FRAGMENT = /* glsl */ `
${COMMON}
uniform float g_flBloomScale;
uniform float g_flToneMapScalarLinear;
uniform vec2 g_flThresholdParams;
uniform float g_flSceneBloomWeight;
uniform bool g_bEffectsBloom;
uniform bool g_bEffectsBloomClamped;
uniform bool g_bEffectsBloomEncoded;

uniform sampler2D inputTexture;

// Geometry drawn only to glow, at a lower resolution than the scene, bloomed without the threshold
uniform sampler2D g_tEffectsBloom;

const vec3 LUMINANCE_WEIGHTS = vec3(0.3, 0.59, 0.11);

float CalculateLuminance(vec3 color) {
    return dot(color, LUMINANCE_WEIGHTS);
}

vec3 ApplyThreshold(vec3 color) {
    float luminance = CalculateLuminance(color);
    float thresholdFactor = g_flToneMapScalarLinear * luminance * g_flThresholdParams.y + g_flThresholdParams.x;
    float thresholdWeight = clamp(thresholdFactor, 0.0, 1.0);
    return color * thresholdWeight;
}

float KarisWeight(vec3 color) {
    return 1.0 / (1.0 + CalculateLuminance(color));
}

vec3 KarisAverage(vec3 a, vec3 b, vec3 c, vec3 d) {
    float wa = KarisWeight(a);
    float wb = KarisWeight(b);
    float wc = KarisWeight(c);
    float wd = KarisWeight(d);
    return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}

vec4 DownsampleJimenez(vec2 uv) {
    vec4 center = textureLod(inputTexture, uv, 0.0);

    vec4 topLeft = textureLodOffset(inputTexture, uv, 0.0, ivec2(-1, -1));
    vec4 topRight = textureLodOffset(inputTexture, uv, 0.0, ivec2(1, -1));
    vec4 bottomLeft = textureLodOffset(inputTexture, uv, 0.0, ivec2(-1, 1));
    vec4 bottomRight = textureLodOffset(inputTexture, uv, 0.0, ivec2(1, 1));

    vec4 top = textureLodOffset(inputTexture, uv, 0.0, ivec2(0, -2));
    vec4 left = textureLodOffset(inputTexture, uv, 0.0, ivec2(-2, 0));
    vec4 right = textureLodOffset(inputTexture, uv, 0.0, ivec2(2, 0));
    vec4 bottom = textureLodOffset(inputTexture, uv, 0.0, ivec2(0, 2));

    vec4 topLeftFar = textureLodOffset(inputTexture, uv, 0.0, ivec2(-2, -2));
    vec4 topRightFar = textureLodOffset(inputTexture, uv, 0.0, ivec2(2, -2));
    vec4 bottomLeftFar = textureLodOffset(inputTexture, uv, 0.0, ivec2(-2, 2));
    vec4 bottomRightFar = textureLodOffset(inputTexture, uv, 0.0, ivec2(2, 2));

    vec3 centerBox = KarisAverage(topLeft.rgb, topRight.rgb, bottomLeft.rgb, bottomRight.rgb);
    vec3 topLeftBox = KarisAverage(topLeftFar.rgb, top.rgb, left.rgb, center.rgb);
    vec3 topRightBox = KarisAverage(topRightFar.rgb, top.rgb, right.rgb, center.rgb);
    vec3 bottomLeftBox = KarisAverage(bottomLeftFar.rgb, bottom.rgb, left.rgb, center.rgb);
    vec3 bottomRightBox = KarisAverage(bottomRightFar.rgb, bottom.rgb, right.rgb, center.rgb);

    return vec4(centerBox * 0.5 + (topLeftBox + topRightBox + bottomLeftBox + bottomRightBox) * 0.125, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy * 4.0 / vec2(textureSize(inputTexture, 0));

    vec4 downsampledColor = DownsampleJimenez(uv);
    vec3 bloomColor = ApplyThreshold(downsampledColor.rgb) * g_flSceneBloomWeight * g_flBloomScale;

    if (g_bEffectsBloom)
    {
        // A bilinear tap at the output texel centre averages the half resolution effects texels it covers
        vec3 effectsColor = textureLod(g_tEffectsBloom, uv, 0.0).rgb;

        if (g_bEffectsBloomClamped)
        {
            effectsColor = clamp(effectsColor, 0.0, 1.0);
        }

        if (g_bEffectsBloomEncoded)
        {
            effectsColor = SrgbLinearToGamma(effectsColor);
        }

        bloomColor += effectsColor;
    }

    outputColor = vec4(bloomColor, 1.0);
}
`;

/**
 * gaussian_bloom_blur by D_BLUR_PASS: 0 a 2x2 box downsample into the next mip, 1 and 2 the
 * horizontal and vertical gaussian, 3 the upsample of the mip below blended over the target mip,
 * 4 the final upsample of the first two mips into the bloom output. Every mip is its own texture
 * here, so the source is always sampled at its top level.
 */
export function bloomBlurFragment(pass: 0 | 1 | 2 | 3 | 4): string {
  return /* glsl */ `
#define D_BLUR_PASS ${pass}
${COMMON}
// xy is one over the source texture size, zw the last texel centre the blur may sample
uniform vec4 g_vTexelSize;
uniform sampler2D g_tSource;

#if D_BLUR_PASS == 1 || D_BLUR_PASS == 2
    const float pixelOffsets[4] = float[4](-2.196197, -0.430063, 1.0, 2.196197);
    const float gaussianWeights[4] = float[4](0.121596, 0.529213, 0.227595, 0.121596);
#elif D_BLUR_PASS >= 3
    // xy scales target pixels to source uv, zw clamps the uv to the last source texel centre
    uniform vec4 g_vCombineUVScaleAndClamp;
    uniform vec3 g_vPrevMipBlurTint;
#endif

#if D_BLUR_PASS == 4
    uniform vec3 g_vCurrMipBlurTint;
    // zw clamps the uv to the last texel centre of the second source mip
    uniform vec4 g_vCombineUVScaleAndClamp2;
    uniform sampler2D g_tSource2;
#endif

vec3 SampleSource(vec2 uv)
{
    return textureLod(g_tSource, uv, 0.0).rgb;
}

void main()
{
#if D_BLUR_PASS == 0
    vec3 color = SampleSource(gl_FragCoord.xy * 2.0 * g_vTexelSize.xy);
    outputColor = vec4(clamp(color, 0.0, 65504.0), 1.0);
#elif D_BLUR_PASS == 1 || D_BLUR_PASS == 2
    vec3 blurOutput = vec3(0.0);

    for (int i = 0; i < 4; i++)
    {
    #if D_BLUR_PASS == 1
        vec2 offset = vec2(pixelOffsets[i], 0.0);
    #else
        vec2 offset = vec2(0.0, pixelOffsets[i]);
    #endif

        vec2 samplePos = min(gl_FragCoord.xy + offset, g_vTexelSize.zw);
        blurOutput += SampleSource(samplePos * g_vTexelSize.xy) * gaussianWeights[i];
    }

    outputColor = vec4(blurOutput, 1.0);
#else
    vec2 uvScale = g_vCombineUVScaleAndClamp.xy;
    vec2 uvClamp = g_vCombineUVScaleAndClamp.zw;
    vec2 filterRadius = vec2(1.0);

    vec2 minUV = min(uvScale * (gl_FragCoord.xy - filterRadius), uvClamp);
    vec2 maxUV = min(uvScale * (gl_FragCoord.xy + filterRadius), uvClamp);

    vec3 upsampled = SampleSource(minUV);
    upsampled += SampleSource(vec2(minUV.x, maxUV.y));
    upsampled += SampleSource(maxUV);
    upsampled += SampleSource(vec2(maxUV.x, minUV.y));
    upsampled *= 0.25;

    #if D_BLUR_PASS == 3
        outputColor = vec4(upsampled * g_vPrevMipBlurTint, 1.0);
    #else
        vec2 source2UV = min(g_vCombineUVScaleAndClamp.xy * gl_FragCoord.xy, g_vCombineUVScaleAndClamp2.zw);
        vec3 currentMip = textureLod(g_tSource2, source2UV, 0.0).rgb;
        outputColor = vec4(upsampled + g_vCurrMipBlurTint * currentMip, 1.0);
    #endif
#endif
}
`;
}

export const POST_PROCESSING_FRAGMENT = /* glsl */ `
${COMMON}
#ifndef D_BLOOM
#define D_BLOOM 0
#endif

uniform bool g_bPostProcessEnabled;

uniform float g_flToneMapScalarLinear;
uniform float g_flExposureBiasScaleFactor;
uniform float g_flShoulderStrength;
uniform float g_flLinearStrength;
uniform float g_flLinearAngle;
uniform float g_flToeStrength;
uniform float g_flToeNum;
uniform float g_flToeDenom;
uniform float g_flWhitePoint;
uniform float g_flWhitePointScale;
uniform float g_flFullScreenGamma;

uniform float g_flColorCorrectionDefaultWeight;
uniform vec2 g_vColorCorrectionColorRange;
uniform vec4 g_vBlueNoiseDitherParams;
uniform bool g_bDither;

uniform sampler2D g_tColorBuffer;
uniform sampler3D g_tColorCorrectionLUT;
uniform sampler2D g_tBlueNoise;

#if (D_BLOOM == 1)
    uniform vec4 g_vBloomUvScaleClamp;
    uniform vec3 g_vUnNormalizedBloomStrengths;
    uniform vec3 g_vNormalizedBloomStrengths;

    // Whether the bloom was thresholded from the exposed scene, so it already carries the exposure
    uniform bool g_bBloomExposed;

    uniform sampler2D g_tBloom;
#endif

vec3 TonemapColor(vec3 vColor)
{
    vColor = min(vColor * 2.8, vec3(g_flWhitePoint));

    // Uncharted tonemapper
    vec3 tonemapNumerator = vColor * (g_flShoulderStrength * vColor + g_flLinearStrength * g_flLinearAngle) + g_flToeNum * g_flToeStrength;
    vec3 tonemapDenominator = vColor * (g_flShoulderStrength * vColor + g_flLinearStrength) + g_flToeDenom * g_flToeStrength;

    vec3 vTonemappedColor = tonemapNumerator / tonemapDenominator - g_flToeNum / g_flToeDenom;

    // Divide by tonemapped white point (pre-calculated on CPU)
    vTonemappedColor *= g_flWhitePointScale;

    return vTonemappedColor;
}

vec3 ApplyColorCorrection(vec3 vColor)
{
    vec3 scaledColor = saturate(vColor) * g_vColorCorrectionColorRange.x + g_vColorCorrectionColorRange.y;
    vec3 ColorCorrectedColor = textureLod(g_tColorCorrectionLUT, scaledColor, 0.0).rgb;
    return mix(vColor, ColorCorrectedColor, g_flColorCorrectionDefaultWeight);
}

vec3 DitherColor(vec3 vColor)
{
    vec2 blueNoiseCoords = gl_FragCoord.xy * g_vBlueNoiseDitherParams.z + g_vBlueNoiseDitherParams.xy;
    vec3 blueNoise = textureLod(g_tBlueNoise, blueNoiseCoords, 0.0).rgb;

    vec3 subPrecisionDither = (blueNoise - 0.5) * g_vBlueNoiseDitherParams.w;
    return vColor + subPrecisionDither;
}

void main()
{
    vec2 fragCoord = gl_FragCoord.xy / vec2(textureSize(g_tColorBuffer, 0));
    vec4 vColor = textureLod(g_tColorBuffer, fragCoord, 0.0);

    if (g_bPostProcessEnabled)
    {
        // The bloom terms are weighted by the exposure on its own, not by the exposed color
        float flExposure = g_flToneMapScalarLinear * g_flExposureBiasScaleFactor;
        vColor.rgb *= flExposure;

        #if (D_BLOOM == 1)
            vec3 bloomSample = textureLod(g_tBloom, (min(fragCoord, g_vBloomUvScaleClamp.zw) * g_vBloomUvScaleClamp.xy).xy, 0.0).xyz;

            // BLUR bloom
            float flBlurBloomExposure = g_bBloomExposed ? 1.0 : flExposure;
            vColor.rgb *= 1.0 - g_vUnNormalizedBloomStrengths.z;
            vColor.rgb += bloomSample * (g_vNormalizedBloomStrengths.z * flBlurBloomExposure);

            // ADD bloom, not weighted by exposure
            vColor.rgb += (bloomSample.rgb * g_vNormalizedBloomStrengths.x);
        #endif

        vColor.rgb = TonemapColor(vColor.rgb);
        vColor.rgb = SrgbLinearToGamma(vColor.rgb);

        #if (D_BLOOM == 1)
            // SCREEN bloom, blended against the gamma encoded color
            vec3 screenBloomSample = bloomSample.rgb * flExposure;
            vec3 screenBlend = saturate((screenBloomSample / (screenBloomSample + 0.187)) * 1.035);
            screenBlend *= g_vNormalizedBloomStrengths.y;

            vColor.rgb = (vColor.rgb + screenBlend) - (vColor.rgb * screenBlend);
        #endif

        if (g_flColorCorrectionDefaultWeight > 0.0)
        {
            vColor.rgb = ApplyColorCorrection(vColor.rgb);
        }

        vColor.rgb = pow(max(vColor.rgb, vec3(0.0)), vec3(g_flFullScreenGamma * (1.0 / 2.2)));

        if (g_bDither)
        {
            vColor.rgb = DitherColor(vColor.rgb);
        }
    }

    outputColor = vColor;
}
`;
