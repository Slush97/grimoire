import { DEADLOCK_BASE_POST, applyTonemapping } from '../../lib/particles/render/post';

// Share the post volume's units with SourcePostPass. White point and exposure
// bias are authored in stops; the 2.8 pre-scale precedes the channel curves.
export const DEADLOCK_TONE = {
  white: 2 ** DEADLOCK_BASE_POST.tonemap.whitePoint,
  scale: 2.8 * 2 ** DEADLOCK_BASE_POST.tonemap.exposureBias,
};

export function deadlockTone(value: number): number {
  const { white, scale } = DEADLOCK_TONE;
  const curve = (x: number) => applyTonemapping(DEADLOCK_BASE_POST.tonemap, x);
  return Math.max(0, curve(Math.min(white, Math.max(0, value) * scale)) / curve(white));
}

export const DEADLOCK_TONE_SHADER = /* glsl */ `
  uniform float previewExposure;
  float previewCurve(float x) {
    return (x * (${DEADLOCK_BASE_POST.tonemap.shoulderStrength} * x + ${DEADLOCK_BASE_POST.tonemap.linearStrength} * ${DEADLOCK_BASE_POST.tonemap.linearAngle}) + ${DEADLOCK_BASE_POST.tonemap.toeStrength} * ${DEADLOCK_BASE_POST.tonemap.toeNum.toFixed(1)}) /
      (x * (${DEADLOCK_BASE_POST.tonemap.shoulderStrength} * x + ${DEADLOCK_BASE_POST.tonemap.linearStrength}) + ${DEADLOCK_BASE_POST.tonemap.toeStrength} * ${DEADLOCK_BASE_POST.tonemap.toeDenom}) - ${DEADLOCK_BASE_POST.tonemap.toeNum.toFixed(1)} / ${DEADLOCK_BASE_POST.tonemap.toeDenom};
  }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 v = clamp(inputColor.rgb * previewExposure * ${DEADLOCK_TONE.scale}, 0.0, ${DEADLOCK_TONE.white});
    outputColor = vec4(clamp(vec3(previewCurve(v.r), previewCurve(v.g), previewCurve(v.b)) /
      previewCurve(${DEADLOCK_TONE.white}), 0.0, 1.0), inputColor.a);
  }
`;
