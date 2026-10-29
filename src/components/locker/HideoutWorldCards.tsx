import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SOURCE_TO_GLTF, hideoutDrawTint, hideoutGammaTint } from '../../lib/hideoutTransform';
import { getMorphic } from '../../lib/source2NprMaterial';
import { isWorldParticleCard, worldCardData } from '../../lib/mapParticleMaterial';
import { ModelMaterial } from '../../lib/particles/render/modelMaterial';
import { DEADLOCK_GAME_SETTINGS, ParticleRendererContext } from '../../lib/particles/render/context';
import { VTexFormat } from '../../lib/particles/render/sheet';
import { ADDITIVE_OVERLAY_RENDER_ORDER } from '../../lib/source2Preview/types';
import { viewFromCamera } from '../../lib/particles/render/view';

export function HideoutWorldCards({ parent }: { parent: THREE.Group }) {
  const current = useRef<{ context: ParticleRendererContext; mesh: THREE.Mesh; materials: ModelMaterial[]; restore: () => void }[]>([]);
  const sourceToViewer = useRef(new THREE.Matrix4()), viewerToSource = useRef(new THREE.Matrix4()), modelToSource = useRef(new THREE.Matrix4());
  useEffect(() => {
    parent.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      if (!originals.some(isWorldParticleCard)) return;
      const textures = new Map<string, THREE.Texture>();
      const materials: ModelMaterial[] = [];
      for (const original of originals) {
        const data = getMorphic(original);
        for (const [slot, path] of Object.entries(data?.texture_slots ?? {})) {
          const texture = data?.resolvedTextures?.[slot] ?? (slot === 'g_tColor' && 'map' in original && original.map instanceof THREE.Texture ? original.map : null);
          if (texture) textures.set(path, texture);
        }
      }
      const context = new ParticleRendererContext({ get: path => {
        const texture = textures.get(path);
        return texture ? { texture, info: { width: 1, height: 1, format: VTexFormat.RGBA8888, flags: 0,
          mipLevels: 2, motionVectorsMaxDistance: 0, sheet: null } } : null;
      } }, DEADLOCK_GAME_SETTINGS, [0, 0, 0], camera => viewFromCamera(camera, sourceToViewer.current, [1, 1]));
      const replacements = originals.map(original => {
        if (!isWorldParticleCard(original)) return original;
        const built = new ModelMaterial(worldCardData(original), context, object.geometry.hasAttribute('color'), object instanceof THREE.SkinnedMesh);
        built.material.name = original.name;
        built.material.userData = original.userData;
        // The node's tint times the draw call's (the Maelstrom glows' green); opacity already holds both alphas.
        const tint = object.userData.hideoutTint;
        const node = Array.isArray(tint) && tint.length === 3 ? tint.map(Number) : [1, 1, 1];
        built.setTint(hideoutGammaTint(node, hideoutDrawTint(object.geometry.userData.morphic_tint)), original.opacity);
        // three.js fills the glass's transmission image from the opaque queue only, so a transparent card
        // behind a window (the Maelstrom's glows) vanished through it. Additive light does not depend on
        // draw order: draw it in the opaque queue after the room, as ParticleEffect does for hero glass.
        if (built.material.blending === THREE.CustomBlending && built.material.blendDst === THREE.OneFactor) {
          built.material.transparent = false;
          object.renderOrder = ADDITIVE_OVERLAY_RENDER_ORDER;
        }
        materials.push(built);
        return built.material;
      });
      const original = object.material, order = object.renderOrder;
      object.material = Array.isArray(original) ? replacements : replacements[0];
      current.current.push({ context, mesh: object, materials, restore: () => { object.material = original; object.renderOrder = order; } });
    });
    return () => {
      for (const entry of current.current) { entry.restore(); entry.materials.forEach(material => material.dispose()); entry.context.dispose(); }
      current.current = [];
    };
  }, [parent]);
  useFrame(({ camera, clock }) => {
    if (!current.current.length) return;
    parent.updateWorldMatrix(true, false);
    sourceToViewer.current.multiplyMatrices(parent.matrixWorld, SOURCE_TO_GLTF);
    viewerToSource.current.copy(sourceToViewer.current).invert();
    const view = viewFromCamera(camera, sourceToViewer.current, [1, 1]);
    for (const { mesh, context, materials } of current.current) {
      mesh.updateWorldMatrix(true, false);
      // eslint-disable-next-line react-hooks/immutability -- R3F advances the mutable render context each frame.
      context.time = clock.elapsedTime;
      modelToSource.current.multiplyMatrices(viewerToSource.current, mesh.matrixWorld);
      const e = modelToSource.current.elements;
      for (const material of materials) {
        // morphic stores vertices in Source model units beneath a conversion node.
        material.setModelTransform(modelToSource.current);
        material.setModelScale([Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])]);
        material.update(view, context);
      }
    }
  });
  return null;
}
