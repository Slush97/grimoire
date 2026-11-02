// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/ParticleExpressions.cs.

import { ScalarExpressionType as S, VectorExpressionType as V } from '../enums';
import { Vector3, cross, f32, lerpV, maxV, minV, saturate } from '../numerics';
import { FLOAT_EPSILON, FLOAT_MIN_NORMAL } from './particleMath';

export function evaluateScalar(expression: number, a: number, b: number, truncatedRemainder = false): number | null {
  switch (expression) {
    case S.SCALAR_EXPRESSION_ADD: return f32(a + b);
    case S.SCALAR_EXPRESSION_SUBTRACT: return f32(a - b);
    case S.SCALAR_EXPRESSION_MUL: return f32(a * b);
    case S.SCALAR_EXPRESSION_DIVIDE: return b === 0 ? 0 : f32(a / b);
    case S.SCALAR_EXPRESSION_INPUT_1: return a;
    case S.SCALAR_EXPRESSION_MIN: return Math.min(a, b);
    case S.SCALAR_EXPRESSION_MAX: return Math.max(a, b);
    case S.SCALAR_EXPRESSION_MOD: {
      if (!truncatedRemainder) {
        return b === 0 ? a : f32(a % b);
      }
      const quotient = f32(a / b);
      const truncated = Number.isNaN(quotient) || Math.abs(quotient) >= 2147483648 ? -2147483648 : Math.trunc(quotient);
      return f32(a - f32(b * f32(truncated)));
    }
    case S.SCALAR_EXPRESSION_EQUAL: return a === b ? 1 : 0;
    case S.SCALAR_EXPRESSION_GT: return a > b ? 1 : 0;
    case S.SCALAR_EXPRESSION_LT: return a < b ? 1 : 0;
    default: return null;
  }
}
export function evaluateVector(expression: number, a: Vector3, b: Vector3, lerp: number, blockForm: boolean): Vector3 | null {
  switch (expression) {
    case V.VECTOR_EXPRESSION_ADD: return a.add(b);
    case V.VECTOR_EXPRESSION_SUBTRACT: return a.sub(b);
    case V.VECTOR_EXPRESSION_MUL: return a.mul(b);
    case V.VECTOR_EXPRESSION_DIVIDE: {
      const nonZero = (x: number) => Math.abs(x) < FLOAT_MIN_NORMAL ? (x < 0 || Object.is(x, -0) ? -FLOAT_EPSILON : FLOAT_EPSILON) : x;
      return new Vector3(a.x / (blockForm ? nonZero(b.x) : b.x), a.y / (blockForm ? nonZero(b.y) : b.y), a.z / (blockForm ? nonZero(b.z) : b.z));
    }
    case V.VECTOR_EXPRESSION_INPUT_1: return a;
    case V.VECTOR_EXPRESSION_MIN: return minV(a, b);
    case V.VECTOR_EXPRESSION_MAX: return maxV(a, b);
    case V.VECTOR_EXPRESSION_CROSSPRODUCT: return cross(a, b);
    case V.VECTOR_EXPRESSION_LERP: return lerpV(a, b, blockForm ? saturate(lerp) : lerp);
    default: return null;
  }
}
