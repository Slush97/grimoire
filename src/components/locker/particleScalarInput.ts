import { ageCurveValue, paramScalar } from './fxDescriptor';

/** Offline particle CPs have zero components unless supplied. Runtime gameplay
 * inputs are not replaced with invented full-strength values. */
export function particleScalarInput(input: unknown, cpComponents: Readonly<Record<number, number>> = {}, fallback = 0, random = Math.random): number {
  if (!input || typeof input !== 'object') return paramScalar(input, fallback);
  const p = input as Record<string, unknown>;
  if (p.pf === 'PF_TYPE_CONTROL_POINT_COMPONENT') {
    const value = cpComponents[paramScalar(p.cp, 0)] ?? 0;
    if (p.map === 'PF_MAP_TYPE_CURVE') return ageCurveValue({ ...p, pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED' }, value, fallback);
    if (p.map === 'PF_MAP_TYPE_REMAP') {
      const lo = paramScalar(p.in0, 0), hi = paramScalar(p.in1, 1), t = hi === lo ? 0 : Math.max(0, Math.min(1, (value-lo)/(hi-lo)));
      return paramScalar(p.out0, 0)+(paramScalar(p.out1, 1)-paramScalar(p.out0, 0))*t;
    }
    return value*(p.map === 'PF_MAP_TYPE_MULT' ? paramScalar(p.mult, 1) : 1);
  }
  if (p.pf === 'PF_TYPE_RANDOM_UNIFORM' || p.pf === 'PF_TYPE_RANDOM_BIASED') {
    let t = random();
    if (p.pf === 'PF_TYPE_RANDOM_BIASED' && p.biasType === 'PF_BIAS_TYPE_STANDARD') {
      const bias = Math.max(.001, Math.min(.999, (paramScalar(p.bias, 0)+1)/2));
      t = t/((1/bias-2)*(1-t)+1);
    }
    return paramScalar(p.min, fallback)+(paramScalar(p.max, fallback)-paramScalar(p.min, fallback))*t;
  }
  return paramScalar(input, fallback);
}
