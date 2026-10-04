import * as THREE from 'three';
import type { ClothDebugSnapshot } from '../lib/useClothSim';

// Geometry is retained across frames; the lab only updates transforms and buffers.
export class ClothOverlay {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly targets: THREE.Points;
  private readonly rods: THREE.LineSegments;
  private readonly errors: THREE.LineSegments;
  private readonly colliders = new THREE.Group();
  private readonly shapes: THREE.Group[] = [];
  private readonly sphere = new THREE.SphereGeometry(1, 12, 8);
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  private readonly bodyMaterial = new THREE.MeshBasicMaterial({ color: '#ffb86b', wireframe: true, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();

  constructor() {
    this.group.matrixAutoUpdate = false;
    this.points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    this.targets = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: '#ff78dc', depthTest: false }));
    this.rods = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#63edc2', transparent: true, opacity: 0.6, depthTest: false }));
    this.errors = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff78dc', transparent: true, opacity: 0.75, depthTest: false }));
    this.group.add(this.points, this.targets, this.rods, this.errors, this.colliders);
    this.group.traverse((object) => { object.renderOrder = 5; object.frustumCulled = false; });
  }

  private buffer(geometry: THREE.BufferGeometry, name: string, values: number[]) {
    const attribute = geometry.getAttribute(name);
    if (attribute?.array.length === values.length) {
      attribute.array.set(values);
      attribute.needsUpdate = true;
    } else {
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
    }
  }

  update(snapshot: ClothDebugSnapshot, options: { nodes: boolean; targets: boolean; colliders: boolean }) {
    this.group.matrix.fromArray(snapshot.modelToWorld);
    this.group.matrixWorldNeedsUpdate = true;
    this.points.visible = this.rods.visible = options.nodes;
    this.targets.visible = this.errors.visible = options.targets;
    this.colliders.visible = options.colliders;
    if (options.nodes) {
      this.buffer(this.points.geometry, 'position', snapshot.nodes.flatMap((node) => node.position));
      this.buffer(this.points.geometry, 'color', snapshot.nodes.flatMap((node) => node.kinematic ? [1, 0.82, 0.3] : [0.39, 0.93, 0.76]));
      this.buffer(this.rods.geometry, 'position', snapshot.rods.flatMap((rod) => [...snapshot.nodes[rod.a].position, ...snapshot.nodes[rod.b].position]));
    }
    if (options.targets) {
      this.buffer(this.targets.geometry, 'position', snapshot.nodes.flatMap((node) => node.target));
      this.buffer(this.errors.geometry, 'position', snapshot.nodes.flatMap((node) => [...node.position, ...node.target]));
    }
    if (!options.colliders) return;
    const count = snapshot.capsules.length + snapshot.boxes.length;
    while (this.shapes.length < count) {
      const shape = new THREE.Group();
      this.shapes.push(shape);
      this.colliders.add(shape);
    }
    this.shapes.forEach((shape, index) => { shape.visible = index < count; });
    snapshot.capsules.forEach((cap, index) => {
      const shape = this.shapes[index];
      if (shape.children.length === 0) {
        shape.add(new THREE.Mesh(this.sphere, this.bodyMaterial), new THREE.Mesh(this.sphere, this.bodyMaterial), new THREE.Mesh(this.cylinder.clone(), this.bodyMaterial));
      }
      const [a, b, shaft] = shape.children;
      a.position.fromArray(cap.a); a.scale.setScalar(cap.ra);
      b.position.fromArray(cap.b); b.scale.setScalar(cap.rb);
      this.direction.subVectors(b.position, a.position);
      const length = this.direction.length();
      shaft.visible = length > 1e-6;
      if (shaft instanceof THREE.Mesh && shaft.visible) {
        // End spheres plus a tapered shaft show the shape's extent. Contact
        // sampling shifts toward the larger sphere; diagnostics use that solver.
        const positions = shaft.geometry.getAttribute('position');
        const original = this.cylinder.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const radius = original.getY(i) > 0 ? cap.rb : cap.ra;
          positions.setXYZ(i, original.getX(i) * radius, original.getY(i) * length, original.getZ(i) * radius);
        }
        positions.needsUpdate = true;
        shaft.position.copy(a.position).lerp(b.position, 0.5);
        shaft.quaternion.setFromUnitVectors(this.axis, this.direction.normalize());
      }
    });
    snapshot.boxes.forEach((box, index) => {
      const shape = this.shapes[snapshot.capsules.length + index];
      if (shape.children.length === 0) shape.add(new THREE.Mesh(this.cube, this.bodyMaterial));
      const mesh = shape.children[0];
      mesh.position.fromArray(box.center);
      mesh.quaternion.fromArray(box.rotation);
      mesh.scale.fromArray(box.halfSize).multiplyScalar(2);
    });
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>([this.sphere, this.cube, this.cylinder]);
    const materials = new Set<THREE.Material>([this.bodyMaterial]);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.group.removeFromParent();
  }
}
