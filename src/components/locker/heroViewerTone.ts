// Deadlock's base postprocess uses a white-normalized Hable curve. These
// coefficients come from basepostprocess_deadlock.vpost, not ACES defaults.
export const DEADLOCK_TONE = {
  shoulder: 0.3538, linear: 0.3258, angle: 0.2528,
  toe: 0.6966, numerator: 0, denominator: 0.7819, white: 3.9996,
};

export function deadlockTone(value: number): number {
  const { shoulder: a, linear: b, angle: c, toe: d, numerator: e, denominator: f, white } = DEADLOCK_TONE;
  const curve = (x: number) => (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f;
  return Math.min(1, Math.max(0, curve(Math.max(0, value)) / curve(white)));
}

export const DEADLOCK_TONE_SHADER = /* glsl */ `
  uniform float previewExposure;
  float previewCurve(float x) {
    return (x * (0.3538 * x + 0.3258 * 0.2528)) /
      (x * (0.3538 * x + 0.3258) + 0.6966 * 0.7819);
  }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 v = max(inputColor.rgb * previewExposure, vec3(0.0));
    outputColor = vec4(clamp(vec3(previewCurve(v.r), previewCurve(v.g), previewCurve(v.b)) /
      previewCurve(3.9996), 0.0, 1.0), inputColor.a);
  }
`;
