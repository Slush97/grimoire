import { describe, expect, it } from 'vitest';
import { particleRopeAcceleration, particleRopeExtraAlpha } from './particleRopeMotion';
import type { FxDescriptor } from './fxDescriptor';
const system = (): FxDescriptor => ({ name:'smoke',controlPoints:[],initializers:[],emitters:[],operators:[],renderers:[],children:[],forces:[{class:'C_OP_CurlNoiseForce',params:{m_vecNoiseFreq:[.2,.2,.2],m_vecNoiseScale:[200,200,50],m_vecOffsetRate:[0,0,3]}}] });
describe('authored rope motion',()=>{
  it('has deterministic spatial curl and evolving collection-time offsets',()=>{
    const d=system(),p:[number,number,number]=[1.2,3.4,5.6];
    const a=particleRopeAcceleration(d,p,.5,1);
    expect(particleRopeAcceleration(d,p,.5,1)).toEqual(a);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(particleRopeAcceleration(d,p,.5,1.1)).not.toEqual(a);
    d.forces![0].params.m_vecNoiseScale=[0,0,0];
    expect(particleRopeAcceleration(d,p,.5,1)).toEqual([0,0,0]);
  });
  it('evaluates authored age-component force amplitudes without replacing them with constants',()=>{
    const d=system();d.forces![0].params.m_vecNoiseScale={m_nType:'PVEC_TYPE_FLOAT_COMPONENTS',m_FloatComponentX:{pf:'PF_TYPE_PARTICLE_AGE_NORMALIZED',curve:{m_spline:[{x:0,y:0},{x:1,y:200}]}},m_FloatComponentY:0,m_FloatComponentZ:0};
    const p:[number,number,number]=[1.2,3.4,5.6];
    expect(particleRopeAcceleration(d,p,0,1)).toEqual([0,0,0]);
    const half=particleRopeAcceleration(d,p,.5,1),full=particleRopeAcceleration(d,p,1,1);
    expect(half[0]).toBeCloseTo(full[0]/2);expect(half.slice(1)).toEqual([0,0]);
  });
  it('retains the separate authored secondary alpha fade',()=>{
    const d=system();d.operators=[{class:'C_OP_SetFloat',params:{m_nOutputField:39,m_InputValue:{pf:'PF_TYPE_PARTICLE_AGE_NORMALIZED',curve:{m_spline:[{x:0,y:.99},{x:1,y:0}]}}}}];
    expect(particleRopeExtraAlpha(d,1,0)).toBe(.99);
    expect(particleRopeExtraAlpha(d,1,1)).toBe(0);
    expect(particleRopeExtraAlpha(d,1,.5)).toBeCloseTo(.495);
  });
});
