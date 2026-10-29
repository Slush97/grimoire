import * as THREE from 'three';

/** Share of the frame's height the hero fills in the hideout's default framing; the room shows above. */
const HERO_SHARE = 0.62;
/** Floor left under the hero's lowest point, as a share of the frame's height. */
const FLOOR_MARGIN = 0.06;
/** The hideout camera's vertical field, wider than the studio's so the room shows around the hero
 * (the game's own is 90 degrees). */
export const HIDEOUT_FOV = 60;

/**
 * The hideout's default framing of a hero's bounds: the hero stands in the lower part of the
 * frame, wide models fitted by width, with the room above. Returns the orbit target and the
 * camera's distance from it along +Z, for a vertical field of `fov` degrees.
 */
export function hideoutFraming(bounds: THREE.Box3, fov: number, aspect: number): { target: THREE.Vector3; distance: number } {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  // The frame's height at the target's depth.
  const span = Math.max(size.y / HERO_SHARE, size.x * 1.2 / Math.max(0.001, aspect));
  const target = new THREE.Vector3(center.x, bounds.min.y - FLOOR_MARGIN * span + span / 2, center.z);
  return { target, distance: span / 2 / tangent + size.z / 2 };
}
