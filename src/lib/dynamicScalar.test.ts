import { describe, it, expect } from 'vitest';
import { compileScalarExpr, peakScalar } from './dynamicScalar';

describe('compileScalarExpr', () => {
  it('evaluates inferno body self-illum pulse and stays in [0,1]', () => {
    const fn = compileScalarExpr('0.5 * sin(3 * time()) + 0.5');
    expect(fn).toBeTypeOf('function');
    expect(fn!(0)).toBeCloseTo(0.5, 5);
    expect(peakScalar(fn!)).toBeCloseTo(1.0, 2);
    for (let t = 0; t < 10; t += 0.13) {
      const v = fn!(t);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('honors precedence, parens, unary minus, bare decimals, builtins', () => {
    expect(compileScalarExpr('2 + 3 * 4')!(0)).toBe(14);
    expect(compileScalarExpr('(2 + 3) * 4')!(0)).toBe(20);
    expect(compileScalarExpr('-.5 + 1')!(0)).toBeCloseTo(0.5, 6);
    expect(compileScalarExpr('frac(1.25)')!(0)).toBeCloseTo(0.25, 6);
    expect(compileScalarExpr('time')!(2.5)).toBe(2.5);
  });

  it('returns null for grammar outside Tier 1 (attributes, vectors, ternary, empty)', () => {
    expect(compileScalarExpr('$SELFILLUM')).toBeNull();
    expect(compileScalarExpr('float2(time, 0)')).toBeNull();
    expect(compileScalarExpr('a < b ? 1.0 : 0.0')).toBeNull();
    expect(compileScalarExpr('')).toBeNull();
    expect(compileScalarExpr('sin(')).toBeNull();
  });
});
