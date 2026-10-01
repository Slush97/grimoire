import { describe, expect, it } from 'vitest';
import { particleScalarInput } from './particleScalarInput';
describe('offline authored particle scalar inputs', () => {
  it('uses zero for an unset CP instead of inventing a full-strength gameplay value', () => {
    const p = { pf: 'PF_TYPE_CONTROL_POINT_COMPONENT', cp: 2, map: 'PF_MAP_TYPE_CURVE', curve: { m_spline: [{x:0,y:.05},{x:1,y:.26}] } };
    expect(particleScalarInput(p)).toBe(.05);
    expect(particleScalarInput(p,{2:1})).toBe(.26);
    expect(particleScalarInput({...p,curve:{m_spline:[{x:0,y:.35},{x:1,y:1}]}})).toBe(.35);
  });
  it('maps CP components with bounded input and preserves biased random source ranges', () => {
    const p = {pf:'PF_TYPE_CONTROL_POINT_COMPONENT',cp:2,map:'PF_MAP_TYPE_REMAP',in0:0,in1:1,out0:1,out1:0};
    expect(particleScalarInput(p)).toBe(1);
    expect(particleScalarInput(p,{2:2})).toBe(0);
    const random = {pf:'PF_TYPE_RANDOM_BIASED',min:.95,max:1.3,bias:-.805,biasType:'PF_BIAS_TYPE_STANDARD'};
    expect(particleScalarInput(random,{},0,()=>0)).toBe(.95);
    expect(particleScalarInput(random,{},0,()=>1)).toBe(1.3);
  });
});
