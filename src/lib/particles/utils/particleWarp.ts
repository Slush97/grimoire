// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/PositionWarp.cs.

import { Matrix4x4, Vector3, transform, transformNormal } from '../numerics';
import { transpose } from './vectorMath';

export function warpPosition(frame: Matrix4x4, warp: Vector3, previousScale: number, position: Vector3, previous: Vector3): {
  position: Vector3;
  previous: Vector3;
} {
  const origin = frame.translation;
  const toLocal = transpose(frame.withTranslation(Vector3.zero));
  const local = transformNormal(position.sub(origin), toLocal);
  const localPrevious = transformNormal(previous.sub(origin), toLocal);
  return { position: transform(local.mul(warp), frame), previous: transform(warp.scale(previousScale).mul(localPrevious), frame) };
}
