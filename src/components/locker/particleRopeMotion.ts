import { ageCurveValue, paramScalar, type FxDescriptor } from './fxDescriptor';
import { particleScalarInput } from './particleScalarInput';
type Vec3 = [number, number, number];
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const vector = (v: unknown, fallback: Vec3): Vec3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v as Vec3 : fallback;
const mix = (a: number, b: number, t: number) => a+(b-a)*t;
// Independent deterministic smooth lattice field. The seed differs by component;
// its curl supplies spatially coherent force, rather than an imposed sine path.
function noise(p: Vec3, seed: number) {
  const cell = p.map(Math.floor), f = p.map((n, i) => n-cell[i]);
  const w = f.map(t => t*t*t*(t*(t*6-15)+10));
  const corner = (x: number, y: number, z: number) => {
    let h = Math.imul(cell[0]+x, 73856093)^Math.imul(cell[1]+y, 19349663)^Math.imul(cell[2]+z, 83492791)^seed;
    h = Math.imul(h^(h>>>16), 2246822519); h ^= h>>>13;
    return (h>>>0)/4294967295*2-1;
  };
  return mix(mix(mix(corner(0,0,0),corner(1,0,0),w[0]),mix(corner(0,1,0),corner(1,1,0),w[0]),w[1]),
    mix(mix(corner(0,0,1),corner(1,0,1),w[0]),mix(corner(0,1,1),corner(1,1,1),w[0]),w[1]),w[2]);
}
function curl(p: Vec3): Vec3 {
  const derivative = (component: number, axis: number) => {
    const lo: Vec3 = [...p], hi: Vec3 = [...p]; lo[axis]-=.01; hi[axis]+=.01;
    return (noise(hi, (component+1)*104729)-noise(lo, (component+1)*104729))/.02;
  };
  return [derivative(2,1)-derivative(1,2),derivative(0,2)-derivative(2,0),derivative(1,0)-derivative(0,1)];
}
function authoredVector(value: unknown, age: number, fallback: Vec3): Vec3 {
  const v = row(value);
  if (v.m_nType === 'PVEC_TYPE_FLOAT_COMPONENTS') return ['X','Y','Z'].map((axis, i) => {
    const input = v['m_FloatComponent'+axis];
    return row(input).pf === 'PF_TYPE_PARTICLE_AGE_NORMALIZED' ? ageCurveValue(input, age, fallback[i]) : paramScalar(input, fallback[i]);
  }) as Vec3;
  if (v.m_nType === 'PVEC_TYPE_LITERAL') return vector(v.m_vLiteralValue, fallback);
  if (v.m_nType) return [0,0,0];
  return vector(value, fallback);
}
/** Source-unit acceleration from the supported authored curl-force subset.
 * This preserves authored amplitudes/frequency/age/offset; noise lattice identity
 * is a preview approximation, not a claim of engine-identical random samples. */
export function particleRopeAcceleration(system: FxDescriptor, position: Vec3, age: number, collectionAge: number): Vec3 {
  const total: Vec3 = [0,0,0];
  for (const node of (system.forces ?? []).slice(0,8)) {
    if (node.class !== 'C_OP_CurlNoiseForce' || (node.params.m_nNoiseType && node.params.m_nNoiseType !== 'PARTICLE_DIR_NOISE_CURL')) continue;
    const frequency = authoredVector(node.params.m_vecNoiseFreq, age, [.02,.02,.02]);
    const rate = authoredVector(node.params.m_vecOffsetRate, age, [0,0,0]);
    const offset = authoredVector(node.params.m_vecOffset, age, [0,0,0]);
    const amplitude = authoredVector(node.params.m_vecNoiseScale, age, [1000,1000,1000]);
    const sample = position.map((v,i)=>v*frequency[i]+offset[i]+collectionAge*rate[i]) as Vec3;
    const force = curl(sample);
    for(let i=0;i<3;i++) total[i]+=force[i]*amplitude[i];
  }
  return total;
}
export function particleRopeExtraAlpha(system: FxDescriptor, initial: number, age: number) {
  let value = initial;
  for (const node of system.operators) if (node.class === 'C_OP_SetFloat' && paramScalar(node.params.m_nOutputField,3) === 39) {
    const next = ageCurveValue(node.params.m_InputValue, age, value);
    value = node.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE' ? initial*next : next;
  }
  return Math.max(0,Math.min(1,value));
}
export function particleRopeInitialField(system: FxDescriptor, field: number, fallback: number) {
  let value = fallback;
  for (const node of system.initializers) if(node.class === 'C_INIT_InitFloat' && paramScalar(node.params.m_nOutputField,3) === field) {
    const next = particleScalarInput(node.params.m_InputValue,{},value);
    value = node.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE' ? value*next : next;
  }
  return value;
}
