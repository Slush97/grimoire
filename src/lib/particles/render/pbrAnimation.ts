// ValveResourceFormat (MIT), 7c55bc2: pbr.vert.slang and pbr.frag.slang.
// Kept shared by world cards and particle models, in Source units.
export const PBR_JITTER_GLSL = /* glsl */ `
#if F_JITTER_VERTICES > 0
uniform sampler2D g_tJitterMask;
uniform vec3 g_vJitterFrequenciesA1;
uniform vec3 g_vJitterAmplitudesXA1;
uniform vec3 g_vJitterAmplitudesYA1;
uniform vec3 g_vJitterAmplitudesZA1;
uniform float g_flJitterSpeedA1;
uniform vec3 g_vJitterFrequenciesB1;
uniform vec3 g_vJitterAmplitudesXB1;
uniform vec3 g_vJitterAmplitudesYB1;
uniform vec3 g_vJitterAmplitudesZB1;
uniform float g_flJitterSpeedB1;
uniform float g_flJitterQuantizeTime1;
uniform float g_flJitterQuantizeDisplacement1;
uniform vec3 g_vJitterExpression;
uniform bool g_bUseSecondaryUvForJitterMask;
uniform float g_flTime;

vec3 GetJitterWave(vec3 position, vec3 frequencies, float speed, float time)
{
    vec3 phase = fract(position * abs(frequencies)) + sign(frequencies) * (time * speed);
    vec3 triangleWave = abs(fract(phase) * 2.0 - 1.0);
    return triangleWave * triangleWave * (3.0 - 2.0 * triangleWave) - 0.5;
}

vec3 GetJitterDisplacement(vec3 position, vec2 maskTexCoord)
{
    float time = g_flJitterQuantizeTime1 != 0.0 ? round(g_flTime / g_flJitterQuantizeTime1) * g_flJitterQuantizeTime1 : g_flTime;
    vec3 waveA = GetJitterWave(position, g_vJitterFrequenciesA1, g_flJitterSpeedA1, time);
    vec3 waveB = GetJitterWave(position, g_vJitterFrequenciesB1, g_flJitterSpeedB1, time);
    vec3 displacement = vec3(dot(g_vJitterAmplitudesXA1, waveA), dot(g_vJitterAmplitudesYA1, waveA), dot(g_vJitterAmplitudesZA1, waveA))
        + vec3(dot(g_vJitterAmplitudesXB1, waveB), dot(g_vJitterAmplitudesYB1, waveB), dot(g_vJitterAmplitudesZB1, waveB)) + g_vJitterExpression;
    if (g_flJitterQuantizeDisplacement1 != 0.0) displacement = round(displacement / g_flJitterQuantizeDisplacement1) * g_flJitterQuantizeDisplacement1;
    return displacement * textureLod(g_tJitterMask, maskTexCoord, 0.0).x;
}
#endif
`;

/** Reference evaluations of the shared shader, for oracle vectors without a GPU. */
export function pbrScrollTime(time: number, quantize: number): number {
  return quantize !== 0 ? Math.round(time / quantize) * quantize : time;
}

export function pbrJitterWave(position: number, frequency: number, speed: number, time: number): number {
  const fract = (x: number) => x - Math.floor(x);
  const phase = fract(position * Math.abs(frequency)) + Math.sign(frequency) * time * speed;
  const triangle = Math.abs(fract(phase) * 2 - 1);
  return triangle * triangle * (3 - 2 * triangle) - 0.5;
}
