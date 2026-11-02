// Dev-only access for deterministic captures of the production viewer.
import { _roots } from '@react-three/fiber';

export function viewerState() {
  const canvas = document.querySelector<HTMLCanvasElement>('#hero-viewer canvas');
  if (!canvas) throw new Error('Viewer canvas is not mounted');
  const root = _roots.get(canvas);
  if (!root) throw new Error('Viewer root is not mounted');
  return root.store.getState();
}
