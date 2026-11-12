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

  it('reads an attribute only from the table the caller passes', () => {
    // Violet's brush: inked while she has ammo, re-inked over the second half of a reload.
    const source = 'max($AmmoPercent,smoothstep(0.5,1,$ReloadProgress))';
    expect(compileScalarExpr(source, { $AmmoPercent: 1, $ReloadProgress: 0 })!(0)).toBe(1);
    expect(compileScalarExpr(source, { $AmmoPercent: 0.25, $ReloadProgress: 0 })!(0)).toBe(0.25);
    expect(compileScalarExpr(source, { $AmmoPercent: 0, $ReloadProgress: 0.75 })!(0)).toBeCloseTo(0.5, 6);
    expect(compileScalarExpr(source, { $AmmoPercent: 1 })).toBeNull();
    expect(compileScalarExpr(source)).toBeNull();
    expect(compileScalarExpr('1 - $ent_health', { $ent_health: 1 })!(0)).toBe(0);
    expect(compileScalarExpr('$toString', {})).toBeNull();
  });

  it('evaluates the multi-argument builtins in the engine argument order', () => {
    expect(compileScalarExpr('min(2, 3) + max(2, 3)')!(0)).toBe(5);
    expect(compileScalarExpr('clamp(0.5 * sin(time()), 0, 0.5)')!(Math.PI / 2)).toBeCloseTo(0.5, 6);
    expect(compileScalarExpr('clamp(-2, 0, 1)')!(0)).toBe(0);
    expect(compileScalarExpr('smoothstep(0, 2, 1)')!(0)).toBeCloseTo(0.5, 6);
    expect(compileScalarExpr('max(1)')).toBeNull();
    expect(compileScalarExpr('clamp(1, 2)')).toBeNull();
  });
});
