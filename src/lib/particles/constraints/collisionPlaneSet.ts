// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Constraints/CollisionPlaneSet.cs.

import type { ParticleCollision } from '../collision';
import { ParticleCollisionMode } from '../enums';
import { FLOAT_MAX, Vector3, distanceSquared, f32 } from '../numerics';

export class CollisionPlaneSet {
  private readonly points = new Array<Vector3>(41).fill(Vector3.zero);
  private readonly normals = new Array<Vector3>(41).fill(Vector3.zero);
  private readonly traceStarts = new Array<Vector3>(41).fill(Vector3.zero);
  private readonly traceEnds = new Array<Vector3>(41).fill(Vector3.zero);
  private readonly valid = new Array<boolean>(41).fill(false);
  private count = 0;
  private nextSlot = 0;
  private retestSlot = 0;
  private lastOrigin = Vector3.zero;
  lastRefreshTime = -1;
  refresh(collision: ParticleCollision, mode: number, origin: Vector3, tolerance: number, force: boolean, time: number): void {
    const traceDown = mode === ParticleCollisionMode.COLLISION_MODE_INITIAL_TRACE_DOWN;
    if (traceDown && this.count !== 0) {
      return;
    }
    if (!force && distanceSquared(origin, this.lastOrigin) < f32(tolerance * tolerance)) {
      return;
    }
    this.lastRefreshTime = time;
    this.lastOrigin = origin;
    if (traceDown) {
      this.trace(collision, 0, origin, Vector3.unitZ.negate());
      this.count = this.nextSlot = 1;
      return;
    }
    if (force && this.nextSlot >= 26) {
      const slot = this.retestSlot > 26 ? 0 : this.retestSlot;
      this.retestSlot = slot + 1;
      this.trace(collision, slot, origin, new Vector3((slot % 3) - 1, (Math.trunc(slot / 3) % 3) - 1, (Math.trunc(slot / 9) % 3) - 1));
      return;
    }
    let next = 0;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        this.trace(collision, next++, origin, new Vector3(x, y, -1));
        if (x !== 0 || y !== 0) {
          this.trace(collision, next++, origin, new Vector3(x, y, 0));
        }
        this.trace(collision, next++, origin, new Vector3(x, y, 1));
      }
    }
    this.count = this.nextSlot = next;
  }
  add(point: Vector3, normal: Vector3): void {
    let slot = this.nextSlot++;
    if (this.count < 41) {
      slot = this.count++;
    }
    else if (this.nextSlot >= 41) {
      slot = this.nextSlot = 26;
    }
    this.store(slot, point, normal);
  }
  intersect(start: Vector3, end: Vector3): {
    hit: boolean;
    fraction: number;
    normal: Vector3;
  } {
    let fraction = 2;
    let normal = Vector3.unitZ;
    for (let i = 0; i < this.count; i++) {
      if (!this.valid[i]) {
        continue;
      }
      const startDistance = start.sub(this.points[i]).dot(this.normals[i]);
      const endDistance = end.sub(this.points[i]).dot(this.normals[i]);
      if (startDistance < 0 || endDistance >= 0) {
        continue;
      }
      const crossing = f32(startDistance / f32(startDistance - endDistance));
      if (crossing < fraction) {
        fraction = crossing;
        normal = this.normals[i];
      }
    }
    return { hit: fraction < 1, fraction, normal };
  }
  pushOut(position: Vector3, radius: number): {
    position: Vector3;
    pushed: boolean;
  } {
    let pushed = false;
    for (let i = 0; i < this.count; i++) {
      if (!this.valid[i]) {
        continue;
      }
      const depth = f32(position.sub(this.points[i]).dot(this.normals[i]) - radius);
      if (depth < 0) {
        position = position.sub(this.normals[i].scale(depth));
        pushed = true;
      }
    }
    return { position, pushed };
  }
  findNearestTrace(start: Vector3, end: Vector3, point: Vector3): {
    distance: number;
    point: Vector3;
  } {
    let best = FLOAT_MAX;
    for (let i = 0; i < this.count; i++) {
      if (!this.valid[i]) {
        continue;
      }
      const distance = Math.max(distanceSquared(start, this.traceStarts[i]), distanceSquared(end, this.traceEnds[i]));
      if (!(best < distance)) {
        best = distance;
        point = this.points[i];
      }
    }
    return { distance: best, point };
  }
  addTrace(start: Vector3, end: Vector3, point: Vector3, normal: Vector3, maxSlot: number): void {
    const slot = this.nextSlot > maxSlot ? 0 : this.nextSlot;
    this.traceStarts[slot] = start;
    this.traceEnds[slot] = end;
    this.store(slot, point, normal);
    this.nextSlot = slot + 1;
    this.count = Math.min(maxSlot, this.count + 1);
  }
  getPlane(slot: number): {
    point: Vector3;
    normal: Vector3;
  } { return { point: this.points[slot], normal: this.normals[slot] }; }
  private trace(collision: ParticleCollision, slot: number, origin: Vector3, direction: Vector3): void {
    const result = collision.traceRay(origin, origin.add(direction.scale(1000)));
    if (result.hit) {
      this.store(slot, result.position, result.normal);
    }
    else {
      this.valid[slot] = false;
    }
  }
  private store(slot: number, point: Vector3, normal: Vector3): void { this.points[slot] = point; this.normals[slot] = normal; this.valid[slot] = true; }
}
