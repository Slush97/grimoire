import { ageCurveValue, paramScalar, type FxDescriptor } from './fxDescriptor';

export function particleControlPointInputs(previewDefaults: Readonly<Record<number, number>> = {}, supplied: Readonly<Record<number, number>> = {}) {
  const result: Record<number, number> = {};
  for (const input of [previewDefaults, supplied]) for (const [key, value] of Object.entries(input).slice(0, 64)) {
    const cp = Number(key);
    if (Number.isInteger(cp) && cp >= 0 && cp < 64 && Number.isFinite(value)) result[cp] = value;
  }
  return result;
}

/** Initial values are applied in authored order, including transparent alpha. */
export function particleInitialScalars(system: FxDescriptor, inputs: Readonly<Record<number, number>> = {}) {
  const values = { life: paramScalar(system.constantLifespan, 1), radius: paramScalar(system.constantRadius, 1), alpha: paramScalar(system.constantAlpha, 1) };
  for (const node of system.initializers.slice(0, 32)) if (node.class === 'C_INIT_InitFloat') {
    const field = paramScalar(node.params.m_nOutputField, 3), key = field === 1 ? 'life' : field === 3 ? 'radius' : field === 7 ? 'alpha' : null;
    if (!key) continue;
    const value = particleScalarInput(node.params.m_InputValue, inputs, values[key]);
    values[key] = node.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE' ? values[key]*value : value;
  }
  return { life: Math.max(.01, Math.min(30, values.life)), radius: Math.max(0, Math.min(128, values.radius)), alpha: Math.max(0, Math.min(1, values.alpha)) };
}

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
