// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/MeshTriangles.cs.
//
// The triangles of a model's most detailed render meshes, with each vertex's bones, for placing
// particles on the surface. VRF builds them from the vertex and index buffers; here a host that has
// decoded those buffers builds them with `fromTriangles`. A model without them reads as having none.

import { Vector3, f32 } from '../numerics';
import { triangleCross } from './quaternionMath';
import type { Matrix4x4 } from '../numerics';

export interface MeshVertex {
  readonly position: Vector3;
  /** Four 16-bit bone indices, remapped to the model's skeleton. */
  readonly bones: bigint;
  /** The weights of the four bones. */
  readonly weights: readonly [number, number, number, number];
  /** Whether the mesh carried a bone remap table, so its bone indices are the skeleton's. */
  readonly remapped: boolean;
}

export class MeshTriangles {
  private readonly vertices: readonly MeshVertex[];
  private readonly indices: readonly number[];
  private readonly areas: readonly number[];
  readonly inverseBindPose: readonly Matrix4x4[];

  private constructor(vertices: readonly MeshVertex[], indices: readonly number[], areas: readonly number[], inverseBindPose: readonly Matrix4x4[]) {
    this.vertices = vertices;
    this.indices = indices;
    this.areas = areas;
    this.inverseBindPose = inverseBindPose;
  }

  /** AddTriangles: every triangle whose corners are all valid vertices, with its area. */
  static fromTriangles(vertices: readonly MeshVertex[], corners: readonly number[], inverseBindPose: readonly Matrix4x4[]): MeshTriangles {
    const indices: number[] = [];
    const areas: number[] = [];

    for (let i = 0; i + 2 < corners.length; i += 3) {
      const [a, b, c] = [corners[i], corners[i + 1], corners[i + 2]];

      if (a < 0 || b < 0 || c < 0 || a >= vertices.length || b >= vertices.length || c >= vertices.length) {
        continue;
      }

      indices.push(a, b, c);
      areas.push(f32(triangleCross(vertices[a].position, vertices[b].position, vertices[c].position).length() * 0.5));
    }

    return new MeshTriangles(vertices, indices, areas, inverseBindPose);
  }

  get triangleCount(): number {
    return this.areas.length;
  }

  area(triangle: number): number {
    return this.areas[triangle];
  }

  corner(triangle: number, corner: number): MeshVertex {
    return this.vertices[this.indices[triangle * 3 + corner]];
  }
}
