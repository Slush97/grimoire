import { describe, expect, it } from 'vitest';
import { particleControlPointInputs, particleInitialScalars, particleScalarInput } from './particleScalarInput';
import type { FxDescriptor } from './fxDescriptor';
describe('offline authored particle scalar inputs', () => {
  it('uses an explicit preview endpoint only when runtime input is absent, preserving supplied zero', () => {
    const curve = { pf: 'PF_TYPE_CONTROL_POINT_COMPONENT', cp: 2, map: 'PF_MAP_TYPE_CURVE', curve: { m_spline: [{x:0,y:.05},{x:1,y:.26}] } };
    expect(particleScalarInput(curve, particleControlPointInputs({2:1}))).toBe(.26);
    expect(particleScalarInput(curve, particleControlPointInputs({2:1},{2:0}))).toBe(.05);
    expect(particleScalarInput(curve, particleControlPointInputs({2:1},{2:.5}))).toBeCloseTo(.155);
    expect(particleControlPointInputs({2:1},{2:NaN})).toEqual({2:1});
  });
  it('retains constant alpha and ordered field7 scaling including fully transparent particles', () => {
    const system: FxDescriptor = {name:'moving',controlPoints:[],emitters:[],operators:[],renderers:[],children:[],initializers:[],constantAlpha:.6};
    expect(particleInitialScalars(system).alpha).toBe(.6);
    system.initializers.push({class:'C_INIT_InitFloat',params:{m_nOutputField:7,m_InputValue:.5,m_nSetMethod:'PARTICLE_SET_SCALE_INITIAL_VALUE'}});
    expect(particleInitialScalars(system).alpha).toBe(.3);
    system.initializers.push({class:'C_INIT_InitFloat',params:{m_nOutputField:7,m_InputValue:0}});
    expect(particleInitialScalars(system).alpha).toBe(0);
    expect(particleInitialScalars({...system,initializers:[],constantAlpha:0}).alpha).toBe(0);
  });
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
