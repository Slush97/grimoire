/**
 * Read-only census of a loaded Source 2 preview scene, for the dev debug panel
 * and the Phase 3 additive-overlay round-trip check. Reports the distributions
 * the plan asks for: material / morphic / additive / self-illum counts, blend
 * mode distribution, render-order distribution, and overlay mesh names.
 *
 * Pure read: it never mutates the scene. Run it AFTER `compileSource2DrawState`
 * to see the applied render orders.
 */
import type * as THREE from 'three';
import { getMorphic, isSelfIllumMaterial } from '../source2NprMaterial';
import { resolveSource2DrawState } from './drawState';
import type { Source2BlendMode } from './types';

export interface Source2SceneSummary {
  /** Every material on every mesh (morphic or not). */
  materialCount: number;
  morphicMaterialCount: number;
  additiveMaterialCount: number;
  translucentMaterialCount: number;
  selfIllumMaterialCount: number;
  unlitMaterialCount: number;
  backfaceMaterialCount: number;
  glassMaterialCount: number;
  /** Count of morphic materials per resolved blend mode. */
  blendModeDistribution: Record<Source2BlendMode, number>;
  /** Count of meshes per current `mesh.renderOrder` value. */
  renderOrderDistribution: Record<number, number>;
  /** Names of meshes carrying an additive or translucent overlay material. */
  overlayMeshNames: string[];
}

export function summarizeSource2Scene(scene: THREE.Object3D): Source2SceneSummary {
  const seen = new Set<THREE.Material>();
  const blendModeDistribution: Record<Source2BlendMode, number> = {
    opaque: 0,
    blend: 0,
    blend_zwrite: 0,
    additive: 0,
  };
  const renderOrderDistribution: Record<number, number> = {};
  const overlayMeshNames: string[] = [];

  const summary: Source2SceneSummary = {
    materialCount: 0,
    morphicMaterialCount: 0,
    additiveMaterialCount: 0,
    translucentMaterialCount: 0,
    selfIllumMaterialCount: 0,
    unlitMaterialCount: 0,
    backfaceMaterialCount: 0,
    glassMaterialCount: 0,
    blendModeDistribution,
    renderOrderDistribution,
    overlayMeshNames,
  };

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const order = mesh.renderOrder ?? 0;
    renderOrderDistribution[order] = (renderOrderDistribution[order] ?? 0) + 1;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let meshIsOverlay = false;
    mats.forEach((mat) => {
      if (!mat || seen.has(mat)) return;
      seen.add(mat);
      summary.materialCount += 1;

      const morphic = getMorphic(mat);
      if (!morphic) return;
      summary.morphicMaterialCount += 1;
      if (isSelfIllumMaterial(mat)) summary.selfIllumMaterialCount += 1;

      const plan = resolveSource2DrawState(morphic, mat);
      blendModeDistribution[plan.blendMode] += 1;
      if (plan.additive) summary.additiveMaterialCount += 1;
      if (plan.translucent) summary.translucentMaterialCount += 1;
      if (plan.unlit) summary.unlitMaterialCount += 1;
      if (plan.backfaces) summary.backfaceMaterialCount += 1;
      if (plan.glass) summary.glassMaterialCount += 1;
      if (plan.isOverlay) meshIsOverlay = true;
    });

    if (meshIsOverlay) overlayMeshNames.push(mesh.name || '(unnamed)');
  });

  return summary;
}
