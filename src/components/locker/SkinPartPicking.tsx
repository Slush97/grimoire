import { useEffect, useEffectEvent } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { attachViewerPartPicker } from '../../lib/viewerPartPicking';

export function SkinPartPicking({ model, onPick }: { model: THREE.Object3D; onPick: (material: string) => void }) {
  const { camera, gl } = useThree();
  const pick = useEffectEvent((material: string) => onPick(material));
  useEffect(() => attachViewerPartPicker(gl.domElement, model, camera, pick), [gl, model, camera]);
  return null;
}
