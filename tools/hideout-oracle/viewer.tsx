import { useEffect, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HideoutScene } from '../../src/components/locker/HideoutScene';
import { Source2MapPost } from '../../src/components/locker/Source2MapPost';
import type { HideoutSceneInfo } from '../../src/types/skinEditor';
type Status = Parameters<ComponentProps<typeof HideoutScene>['onStatus']>[0];
const info: HideoutSceneInfo = await fetch('/@scene/scene.json').then(r => r.json());
const mode = new URLSearchParams(location.search).get('mode') ?? 'post';
if (mode === 'props') info.probes = { kind: 'unavailable' };
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  return nativeFetch(url.startsWith('grimoire-hero://s/') ? `/@scene/${new URL(url).pathname.split('/').slice(2).join('/')}` : input, init);
};
Object.defineProperty(window, 'electronAPI', { value: { loadHideoutScene: async () => info } });
const debug: { info: HideoutSceneInfo; THREE: typeof THREE; started: number; status?: Status; loadMs?: number; state?: ReturnType<typeof useThree> } = { info, THREE, started: performance.now() };
Object.defineProperty(window, '__hideout', { value: debug });
export function Inspect() {
  const state = useThree();
  useEffect(() => { debug.state = state; }, [state]);
  return null;
}
// The scene reports the info it placed the map with, including the view heading.
const status = (value: Status) => { debug.status = value; if (value.kind === 'ready') debug.info = value.info; debug.loadMs = performance.now() - debug.started; };
createRoot(document.getElementById('root')!).render(<Canvas camera={{ fov: 46.826, near: 0.0254, far: 2540 }} gl={{ antialias: false, preserveDrawingBuffer: true }}>
  <Inspect />
  {mode === 'props' && <hemisphereLight args={[new THREE.Color(96/255,135/255,183/255), new THREE.Color(.32,.25,.2), .2]} />}
  <HideoutScene scale={1} floor={0} postprocess={mode === 'post'} onStatus={status} onProbe={() => {}} />
  {mode === 'post' && <Source2MapPost info={info} />}
</Canvas>);
