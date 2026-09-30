import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadGltfPreview } from './loadGltfPreview';
import { loadRiggedHeroPreview } from './loadRiggedHeroPreview';

vi.mock('./loadGltfPreview', () => ({ loadGltfPreview: vi.fn() }));

const info = { key: 'Yamato::addons2/skin_dir.vpk::c123', mtimeMs: 42, hasModel: true };
const raw = {
  m_CtrlName: ['anchor', 'cloth', 'tip'],
  m_nStaticNodes: 1,
  m_InitPose: [
    [0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 0, 1],
    [2, 0, 0, 1, 0, 0, 0, 1],
  ],
};

async function prepareModel() {
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
  }), '');
  vi.mocked(loadGltfPreview).mockResolvedValue(gltf);
  return gltf;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('loadRiggedHeroPreview', () => {
  it('waits for matching physics before returning a scene that can start animation', async () => {
    const gltf = await prepareModel();
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { complete = resolve; });
    const fetch = vi.fn().mockReturnValue(pending);
    vi.stubGlobal('fetch', fetch);
    let ready = false;
    const loading = loadRiggedHeroPreview(info, true).then((result) => { ready = true; return result; });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);
    const base = 'grimoire-hero://m/Yamato%3A%3Aaddons2%2Fskin_dir.vpk%3A%3Ac123';
    expect(loadGltfPreview).toHaveBeenCalledWith(`${base}/model-rigged.glb?v=42`);
    expect(fetch).toHaveBeenCalledWith(`${base}/cloth-rigged.json?v=42`);
    complete(Response.json(raw));
    const result = await loading;
    expect(result.gltf).toBe(gltf);
    expect(result.clothModel?.nodes.map((node) => node.name)).toEqual(raw.m_CtrlName);
  });

  it.each(['absent', 'null', 'malformed', 'network'] as const)('keeps animation usable when physics is %s', async (failure) => {
    const gltf = await prepareModel();
    const fetch = vi.fn();
    if (failure === 'network') fetch.mockRejectedValue(new Error('unavailable'));
    else fetch.mockResolvedValue(failure === 'absent'
      ? new Response(null, { status: 404 })
      : failure === 'malformed' ? new Response('not JSON') : Response.json(null));
    vi.stubGlobal('fetch', fetch);
    expect(await loadRiggedHeroPreview(info, true)).toEqual({ gltf, clothModel: null });
  });

  it('does not fetch physics while disabled', async () => {
    const gltf = await prepareModel();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await loadRiggedHeroPreview(info, false)).toEqual({ gltf, clothModel: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});
