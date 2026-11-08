import { describe, expect, it } from 'vitest';
import { Vector3 } from '../numerics';
import { particleNormalBasis } from './renderSprites';

describe('particleNormalBasis', () => {
  it('stands an asymmetric image the right way up on a horizontal normal rolled a quarter turn, as the game does', () => {
    // The parry shield glyph: normal along its orbit (horizontal), authored roll 90 degrees. Checked in game
    // with an asymmetric stamp: its top is up
    const [right, up] = particleNormalBasis(new Vector3(1, 0, 0), Math.PI / 2, 0);
    expect(up.z).toBeCloseTo(1);
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(0);
    // The image stays in the plane facing along the normal, its right edge across it
    expect(right.x).toBeCloseTo(0);
    expect(Math.abs(right.y)).toBeCloseTo(1);
  });

  it('keeps the card perpendicular to the normal', () => {
    const normal = new Vector3(0.6, 0.8, 0);
    const [right, up] = particleNormalBasis(normal, 0.3, 0);
    expect(right.x * normal.x + right.y * normal.y + right.z * normal.z).toBeCloseTo(0);
    expect(up.x * normal.x + up.y * normal.y + up.z * normal.z).toBeCloseTo(0);
  });
});
