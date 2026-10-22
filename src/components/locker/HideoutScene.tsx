import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { loadGltfPreview, materialTextures } from '../../lib/loadGltfPreview';
import type { HideoutSceneInfo } from '../../types/skinEditor';
import { SOURCE_TO_GLTF, hideoutInstanceMatrix } from '../../lib/hideoutTransform';
import { getMorphic } from '../../lib/source2NprMaterial';

function disposeModels(models: THREE.Object3D[]): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const model of models) model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const texture of materialTextures(material)) textures.add(texture);
      for (const texture of Object.values(getMorphic(material)?.resolvedTextures ?? {})) textures.add(texture);
    }
  });
  geometries.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
  textures.forEach((item) => item.dispose());
}

export function HideoutScene({ scale, floor, onStatus }: {
  scale: number; floor: number;
  onStatus: (status: { kind: 'loading' } | { kind: 'ready'; info: HideoutSceneInfo; failedLoads: number } | { kind: 'failed' }) => void;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let cancelled = false;
    let finished = false;
    const models: THREE.Object3D[] = [];
    const ownedMaterials = new Set<THREE.Material>();
    const dispose = () => { disposeModels(models); ownedMaterials.forEach((material) => material.dispose()); };
    onStatus({ kind: 'loading' });
    void (async () => {
      const info = await window.electronAPI.loadHideoutScene();
      if (cancelled) return;
      const root = new THREE.Group();
      const anchor = new THREE.Vector3(...info.anchor).applyMatrix4(SOURCE_TO_GLTF);
      const unique = [...new Set(info.instances.map((item) => item.model))];
      const loaded = new Map<string, THREE.Object3D>();
      const paintedGeometry = new Set<THREE.BufferGeometry>();
      const unresolvedMaterials = new Set<string>();
      let failedLoads = 0;
      // Limit texture decoding/readback pressure while loading the map cache.
      for (let offset = 0; offset < unique.length && !cancelled; offset += 4) {
        await Promise.all(unique.slice(offset, offset + 4).map(async (name) => {
          try {
            const gltf = await loadGltfPreview(`grimoire-hero://s/${info.key}/${name}`);
            gltf.scene.traverse((object) => {
              const association = gltf.parser.associations.get(object);
              if (association?.primitives !== undefined) object.userData.hideoutPrimitive = association.primitives;
              if (!(object instanceof THREE.Mesh)) return;
              if (paintedGeometry.has(object.geometry)) return;
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              if (!materials.some((material) => getMorphic(material)?.shader.startsWith('environment_'))) return;
              const colors = object.geometry.getAttribute('color');
              if (!colors) return;
              paintedGeometry.add(object.geometry);
              const values = new Float32Array(colors.count * 4);
              const color = new THREE.Color();
              for (let i = 0; i < colors.count; i++) {
                const amount = colors.itemSize === 4 ? colors.getW(i) : 1;
                color.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i)).convertSRGBToLinear();
                values.set([1 + (color.r - 1) * amount, 1 + (color.g - 1) * amount, 1 + (color.b - 1) * amount, 1], i * 4);
              }
              object.geometry.setAttribute('color', new THREE.BufferAttribute(values, 4));
            });
            models.push(gltf.scene);
            loaded.set(name, gltf.scene);
          } catch { failedLoads++; }
        }));
      }
      if (cancelled) return;
      for (const instance of info.instances) {
        const source = loaded.get(instance.model);
        if (!source) continue;
        const holder = new THREE.Group();
        holder.applyMatrix4(hideoutInstanceMatrix(instance.matrix));
        const clone = source.clone(true);
        if (instance.primitive !== null) {
          const remove: THREE.Object3D[] = [];
          let selected = false;
          clone.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            if (object.userData.hideoutPrimitive === instance.primitive) selected = true;
            else remove.push(object);
          });
          remove.forEach((object) => object.removeFromParent());
          if (!selected) { failedLoads++; continue; }
        }
        holder.add(clone);
        holder.updateMatrixWorld(true);
        if (new THREE.Box3().setFromObject(holder).distanceToPoint(anchor) > 65) continue;
        clone.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const prepare = (original: THREE.Material) => {
            const data = original.userData;
            original.userData = {};
            let material: THREE.Material;
            try { material = original.clone(); } finally { original.userData = data; }
            material.userData = data;
            ownedMaterials.add(material);
            if (!getMorphic(original)) {
              material.visible = false;
              unresolvedMaterials.add(original.name);
              return material;
            }
            if (material instanceof THREE.MeshStandardMaterial) {
              const morphic = getMorphic(original);
              const tint = morphic?.vectors?.g_vColorTint1;
              if (morphic?.shader.startsWith('environment_') && tint?.length === 4) {
                material.color.setRGB(tint[0], tint[1], tint[2]).convertSRGBToLinear();
              }
              material.color.multiply(new THREE.Color().setRGB(...instance.tint).convertSRGBToLinear());
            }
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material);
        });
        root.add(holder);
      }
      if (!root.children.length) throw new Error('No nearby hideout geometry loaded.');
      root.position.copy(anchor).negate();
      const oriented = new THREE.Group();
      oriented.rotation.y = -THREE.MathUtils.degToRad(info.heading);
      oriented.add(root);
      setGroup(oriented);
      onStatus({ kind: 'ready', info, failedLoads: failedLoads + unresolvedMaterials.size });
    })().catch(() => { if (!cancelled) onStatus({ kind: 'failed' }); }).finally(() => {
      finished = true;
      if (cancelled) dispose();
    });
    return () => { cancelled = true; if (finished) dispose(); };
  }, [onStatus]);
  return group ? <group scale={scale} position={[0, floor, 0]}><primitive object={group} /></group> : null;
}
