import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { loadGltfPreview, materialTextures } from '../../lib/loadGltfPreview';
import type { HideoutSceneInfo } from '../../types/skinEditor';
import { SOURCE_TO_GLTF, hideoutInstanceMatrix } from '../../lib/hideoutTransform';
import { getMorphic } from '../../lib/source2NprMaterial';
import type { ViewerAmbientProbe } from '../../lib/viewerAmbientLight';

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

export function HideoutScene({ scale, floor, onStatus, onProbe }: {
  scale: number; floor: number;
  onStatus: (status: { kind: 'loading' } | { kind: 'ready'; info: HideoutSceneInfo; failedLoads: number } | { kind: 'failed' }) => void;
  onProbe: (probe: ViewerAmbientProbe) => void;
}) {
  const { gl, scene: viewerScene } = useThree();
  const [group, setGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let cancelled = false;
    let finished = false;
    const models: THREE.Object3D[] = [];
    const ownedMaterials = new Set<THREE.Material>();
    const ownedLights: THREE.PointLight[] = [];
    let lightmap: THREE.DataTexture | null = null;
    let reflection: THREE.WebGLRenderTarget | null = null;
    const dispose = () => {
      disposeModels(models); ownedMaterials.forEach((material) => material.dispose()); ownedLights.forEach((light) => light.dispose()); lightmap?.dispose();
      if (reflection && viewerScene.environment === reflection.texture) viewerScene.environment = null;
      reflection?.dispose();
    };
    onStatus({ kind: 'loading' });
    onProbe({ kind: 'pending' });
    void (async () => {
      const info = await window.electronAPI.loadHideoutScene();
      if (cancelled) return;
      const root = new THREE.Group();
      if (info.lighting.kind === 'baked') {
        const response = await fetch(`grimoire-hero://s/${info.key}/${info.lighting.file}`);
        if (!response.ok) throw new Error('Hideout lightmap could not be read.');
        const data = new HDRLoader().setDataType(THREE.FloatType).parse(await response.arrayBuffer());
        lightmap = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, THREE.FloatType);
        lightmap.colorSpace = THREE.LinearSRGBColorSpace;
        lightmap.channel = 3;
        lightmap.flipY = false;
        lightmap.repeat.set(...info.lighting.uvScale);
        lightmap.minFilter = THREE.LinearFilter;
        lightmap.magFilter = THREE.LinearFilter;
        lightmap.needsUpdate = true;
      }
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
              if (lightmap && object.geometry.hasAttribute('uv3')) {
                material.lightMap = lightmap;
                material.envMapIntensity = 0;
                material.onBeforeCompile = (shader) => {
                  shader.fragmentShader = shader.fragmentShader
                    .replace('#include <lights_fragment_maps>', 'irradiance = vec3(0.0);\n#include <lights_fragment_maps>\niblIrradiance = vec3(0.0);');
                };
                material.customProgramCacheKey = () => 'hideout-baked-dc-v1';
              }
            }
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material);
        });
        root.add(holder);
      }
      if (!root.children.length) throw new Error('No nearby hideout geometry loaded.');
      const lights = info.lights.map((light) => ({ ...light, point: new THREE.Vector3(...light.position).applyMatrix4(SOURCE_TO_GLTF) }))
        .filter((light) => light.point.distanceTo(anchor) < Math.min(20, light.range * 0.0254 + 3) && light.candela > 0)
        .sort((a, b) => b.candela / Math.max(1, b.point.distanceToSquared(anchor)) - a.candela / Math.max(1, a.point.distanceToSquared(anchor)))
        .slice(0, 12);
      lights.forEach((source, index) => {
        const color = new THREE.Color().setRGB(source.color[0] / 255, source.color[1] / 255, source.color[2] / 255).convertSRGBToLinear();
        const light = new THREE.PointLight(color, source.candela, source.range * 0.0254, 2);
        light.position.copy(source.point);
        light.castShadow = index < 3;
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.05;
        light.shadow.camera.far = Math.max(0.1, source.range * 0.0254);
        light.shadow.autoUpdate = index < 2;
        light.shadow.needsUpdate = true;
        light.shadow.bias = -0.0005;
        light.shadow.normalBias = 0.025;
        root.add(light);
        ownedLights.push(light);
      });
      root.position.copy(anchor).negate();
      const oriented = new THREE.Group();
      oriented.rotation.y = -THREE.MathUtils.degToRad(info.heading);
      oriented.add(root);
      const environment = new THREE.Scene();
      environment.add(oriented);
      const cube = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false });
      const pmrem = new THREE.PMREMGenerator(gl);
      let sh: THREE.SphericalHarmonics3;
      try {
        const camera = new THREE.CubeCamera(0.05, 100, cube);
        camera.position.set(0, 1.4, 0);
        camera.update(gl, environment);
        sh = (await LightProbeGenerator.fromCubeRenderTarget(gl, cube)).sh;
        if (!sh.coefficients.every((coefficient) => coefficient.toArray().every(Number.isFinite))) throw new Error('Invalid hideout light probe.');
        reflection = pmrem.fromCubemap(cube.texture);
      } finally { cube.dispose(); pmrem.dispose(); }
      environment.remove(oriented);
      if (cancelled) return;
      // eslint-disable-next-line react-hooks/immutability -- R3F owns the mutable Three.js scene.
      viewerScene.environment = reflection.texture;
      viewerScene.environmentIntensity = 1;
      onProbe({ kind: 'ready', sh });
      for (const light of ownedLights) {
        light.intensity *= scale * scale;
        light.distance *= scale;
        light.shadow.camera.far *= scale;
        light.shadow.needsUpdate = true;
      }
      setGroup(oriented);
      onStatus({ kind: 'ready', info, failedLoads: failedLoads + unresolvedMaterials.size });
    })().catch(() => { if (!cancelled) { onStatus({ kind: 'failed' }); onProbe({ kind: 'fallback' }); } }).finally(() => {
      finished = true;
      if (cancelled) dispose();
    });
    return () => { cancelled = true; if (finished) dispose(); };
  }, [gl, viewerScene, onStatus, onProbe, scale]);
  return group ? <group scale={scale} position={[0, floor, 0]}><primitive object={group} /></group> : null;
}
