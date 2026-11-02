import { useEffect, useEffectEvent } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { attachViewerHover, attachViewerPartPicker, type ViewerPartHit } from '../../lib/viewerPartPicking';

/** `posed` picks against the held pose's cached geometry: for selecting, where the pose is frozen. */
export function SkinPartPicking({ model, onPick, onHover, posed = false }: {
  model: THREE.Object3D; onPick: (material: string, hit: ViewerPartHit) => void; onHover?: (hit: ViewerPartHit | null) => void; posed?: boolean;
}) {
  const { camera, gl } = useThree();
  const pick = useEffectEvent((material: string, hit: ViewerPartHit) => onPick(material, hit));
  const hover = useEffectEvent((hit: ViewerPartHit | null) => onHover?.(hit));
  const hovering = !!onHover;
  useEffect(() => attachViewerPartPicker(gl.domElement, model, camera, pick, posed), [gl, model, camera, posed]);
  useEffect(() => hovering ? attachViewerHover(gl.domElement, model, camera, hover) : undefined, [gl, model, camera, hovering]);
  return null;
}
