import { describe, expect, it } from 'vitest';
import { compileVfxExpression, stringToken } from './vfxEval';

describe('stringToken', () => {
  it('hashes render attribute names as the compiled materials reference them', () => {
    // melee_parry_model.vmat's dynamic params read these tokens
    expect(stringToken('$SELFILLUM')).toBe(0xbad34216);
    expect(stringToken('$ILLUMCOLOR')).toBe(0x07e1f77d);
    expect(stringToken('$OFFSET')).toBe(0x80b2e6ff);
    expect(stringToken('$color')).toBe(stringToken('$COLOR'));
  });
});

describe('compileVfxExpression', () => {
  const offset = stringToken('$OFFSET');
  // g_vTranslucentTexcoordOffset1_1 = float2(-$OFFSET, 0)
  const bytes = [0x19, 0xff, 0xe6, 0xb2, 0x80, 0x18, 0x07, 0, 0, 0, 0, 0x06, 0x1a, 0x00, 0x00];

  it('evaluates an attribute expression', () => {
    const expression = compileVfxExpression(bytes)!;
    expect(expression.attributes).toEqual([offset]);
    expect(expression.evaluate((token) => (token === offset ? [0.25] : undefined))).toEqual([-0.25, 0]);
  });

  it('gives null while an attribute it reads is unset', () => {
    expect(compileVfxExpression(bytes)!.evaluate(() => undefined)).toBeNull();
  });

  it('refuses bytecode outside the supported subset', () => {
    // FEATURE 0, RETURN
    expect(compileVfxExpression([0x1a, 0x00, 0x00])).toBeNull();
    // No RETURN
    expect(compileVfxExpression([0x07, 0, 0, 0x80, 0x3f])).toBeNull();
  });

  it('applies arithmetic and swizzles', () => {
    const color = stringToken('$ILLUMCOLOR');
    // $ILLUMCOLOR.y * 2
    const expression = compileVfxExpression([0x19, 0x7d, 0xf7, 0xe1, 0x07, 0x1e, 0x55, 0x07, 0, 0, 0, 0x40, 0x15, 0x00])!;
    expect(expression.evaluate((token) => (token === color ? [0.1, 0.3, 0.5] : undefined))).toEqual([0.6]);
  });
});
