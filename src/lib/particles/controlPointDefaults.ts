// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ControlPointDefaults.cs.

import { ParticleField } from './enums';
import { Vector3, f32 } from './numerics';
import { MAX_CONTROL_POINT } from './state';

/**
 * The values the particle editor previews a system's unset control points at. Each function adds the
 * control points it reads with the default their use implies, such as white for one read as a colour
 * or one for a scale. Only the nonzero defaults are kept, since an unset control point is zero anyway.
 * Per component the first nonzero default wins. Control point 0 is left out, the preview always
 * places it.
 */
export class ControlPointDefaults {
  private readonly valuesByPoint = new Map<number, [number, number, number]>();

  /** The default of each control point that has a nonzero one. */
  get values(): ReadonlyMap<number, Vector3> {
    return new Map([...this.valuesByPoint].map(([cp, [x, y, z]]) => [cp, new Vector3(x, y, z)]));
  }

  /** A control point read as a colour, white on the 0 to 255 scale. */
  addColor(controlPoint: number): void {
    this.add(controlPoint, Vector3.splat(255));
  }

  /** A control point, or one component of it, read as a scale or a multiplier: one. */
  addScale(controlPoint: number, component?: number): void {
    if (component === undefined) {
      this.add(controlPoint, Vector3.one);
    } else {
      this.addComponent(controlPoint, component, 1);
    }
  }

  /** A control point, or one component of it, remapped into a particle field, at that field's default. */
  addField(controlPoint: number, field: number, component?: number): void {
    if (component === undefined) {
      this.add(controlPoint, fieldDefault(field));
    } else {
      this.addComponent(controlPoint, component, fieldDefault(field).x);
    }
  }

  /** A control point with an explicit default. */
  add(controlPoint: number, value: Vector3): void {
    this.addComponent(controlPoint, 0, value.x);
    this.addComponent(controlPoint, 1, value.y);
    this.addComponent(controlPoint, 2, value.z);
  }

  private addComponent(controlPoint: number, component: number, value: number): void {
    if (controlPoint <= 0 || controlPoint > MAX_CONTROL_POINT || component < 0 || component > 2 || value === 0) {
      return;
    }

    const current = this.valuesByPoint.get(controlPoint) ?? [0, 0, 0];

    if (current[component] !== 0) {
      return;
    }

    current[component] = f32(value);
    this.valuesByPoint.set(controlPoint, current);
  }
}

function fieldDefault(field: number): Vector3 {
  switch (field) {
    case ParticleField.Color:
    case ParticleField.GlowRgb:
      return Vector3.splat(255);
    case ParticleField.Normal:
      return Vector3.unitZ;
    case ParticleField.LifeDuration:
    case ParticleField.Radius:
    case ParticleField.RollSpeed:
    case ParticleField.Alpha:
    case ParticleField.TrailLength:
    case ParticleField.SecondSequenceNumber:
    case ParticleField.AlphaAlternate:
    case ParticleField.GlowAlpha:
    case ParticleField.ForceScale:
      return Vector3.one;
    case ParticleField.ParentParticleIndex:
    case ParticleField.ParentParticleId:
    case ParticleField.RopeSegmentId:
      return Vector3.splat(-1);
    default:
      return Vector3.zero;
  }
}
