// @vitest-environment jsdom
import ReactThreeTestRenderer, { act } from '@react-three/test-renderer';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewTrippySprite } from '../../lib/api';
import type { SkinPartEdit } from '../../types/skinEditor';
import type { TrippySpriteResult } from '../../types/mod';
import { SkinPartPatterns } from './SkinPartPatterns';

vi.mock('../../lib/api', () => ({ previewTrippySprite: vi.fn() }));

const sprite: TrippySpriteResult = { dataUrl: 'data:image/png;base64,pattern', frames: 1, size: 256 };
const edit = (phase = 0, scroll = .5): SkinPartEdit => ({ material: 'coat.vmat', hidden: false, tint: null,
  pattern: { style: 'gradient', intensity: 1, phase, scroll } });
const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
const draws: unknown[] = [];
const ops: Array<['draw', unknown] | ['put', number[]]> = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(previewTrippySprite).mockReset().mockResolvedValue(sprite);
  vi.stubGlobal('ImageBitmap', class {});
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  draws.length = 0; ops.length = 0;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ({
    drawImage: (source: unknown) => { draws.push(source); ops.push(['draw', source]); }, fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([100, 100, 100, 255]) }),
    putImageData: (image: { data: Uint8ClampedArray }) => { ops.push(['put', [...image.data]]); },
  }) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (getContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', getContext);
});

async function bake() { await act(async () => { await vi.advanceTimersByTimeAsync(75); }); }
function model() {
  const source = document.createElement('canvas'); source.width = 8; source.height = 8;
  const original = new THREE.CanvasTexture(source);
  const material = new THREE.MeshStandardMaterial({ map: original }); material.name = 'coat';
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  return { scene, material, original, source };
}

describe('skin part pattern replacement', () => {
  it('uses Moo density in the generated tile without multiplying the material repeat again', async () => {
    const { scene, material, original } = model();
    original.repeat.set(2, 3);
    const onError = vi.fn();
    const moo: SkinPartEdit = { material: 'coat.vmat', tint: null, hidden: false,
      pattern: { style: 'moo', intensity: 1, phase: 0, scroll: .5 } };
    const renderer = await ReactThreeTestRenderer.create(<SkinPartPatterns scene={scene} edits={[moo]} onError={onError} />);
    try {
      await bake();
      expect(previewTrippySprite).toHaveBeenLastCalledWith(expect.objectContaining({ style: 'moo', scale: 1, size: 512 }));
      const first = material.map;
      await renderer.update(<SkinPartPatterns scene={scene} edits={[{ ...moo, pattern: { ...moo.pattern!, scale: 2.25 } }]} onError={onError} />);
      expect(material.map).toBe(first);
      await bake();
      expect(previewTrippySprite).toHaveBeenLastCalledWith(expect.objectContaining({ style: 'moo', scale: 2.25, scroll: 0 }));
      expect(material.map?.repeat).toEqual(original.repeat);
      expect(material.map).not.toBe(first);
      await renderer.update(<SkinPartPatterns scene={scene} edits={[{ ...moo, pattern: { ...moo.pattern!, style: 'gradient', scale: 2.25 } }]} onError={onError} />);
      await bake();
      expect(previewTrippySprite).toHaveBeenLastCalledWith(expect.objectContaining({ style: 'gradient', scale: 1, size: 256 }));
    } finally { await renderer.unmount(); }
  });
  it('paints the base before drawing the pattern so the pattern keeps its colors', async () => {
    const { scene, source } = model(); const onError = vi.fn();
    const painted: SkinPartEdit = { ...edit(), tint: '#ff0000', repaint: true };
    const renderer = await ReactThreeTestRenderer.create(<SkinPartPatterns scene={scene} edits={[painted]} onError={onError} />);
    try {
      await bake();
      expect(onError).not.toHaveBeenCalled();
      // Base texture, then the painted base written back, then the pattern on top.
      expect(ops.map(([kind, value]) => kind === 'draw' ? (value === source ? 'base' : 'pattern') : 'put'))
        .toEqual(['base', 'put', 'pattern', 'put']);
      // A flat texture has no detail to keep, so the paint is exactly the picked red.
      expect(ops[1][1]).toEqual([255, 0, 0, 255]);
    } finally { await renderer.unmount(); }
  });

  it('keeps the applied pattern during debounce and async preparation, then swaps without baking over the previous result', async () => {
    const { scene, material, original, source } = model();
    const onError = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<SkinPartPatterns scene={scene} edits={[edit()]} onError={onError} />);
    try {
      await bake(); const first = material.map; expect(first).not.toBe(original);
      const dispose = vi.spyOn(first!, 'dispose');
      let finish!: (value: TrippySpriteResult) => void;
      vi.mocked(previewTrippySprite).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await renderer.update(<SkinPartPatterns scene={scene} edits={[edit(.2)]} onError={onError} />);
      expect(material.map).toBe(first); expect(dispose).not.toHaveBeenCalled();
      await bake(); expect(material.map).toBe(first);
      draws.length = 0;
      await act(async () => { finish(sprite); });
      expect(material.map).not.toBe(first); expect(material.map).not.toBe(original);
      expect(draws[0]).toBe(source); expect(dispose).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
    } finally { await renderer.unmount(); }
    expect(material.map).toBe(original);
  });

  it('keeps the last pattern if replacement fails and ignores an outdated request after a newer update', async () => {
    const { scene, material, original } = model(); const onError = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<SkinPartPatterns scene={scene} edits={[edit()]} onError={onError} />);
    try {
      await bake(); const first = material.map;
      let finish!: (value: TrippySpriteResult) => void;
      vi.mocked(previewTrippySprite).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await renderer.update(<SkinPartPatterns scene={scene} edits={[edit(.2)]} onError={onError} />); await bake();
      vi.mocked(previewTrippySprite).mockRejectedValueOnce(new Error('decode failed'));
      await renderer.update(<SkinPartPatterns scene={scene} edits={[edit(.4)]} onError={onError} />); await bake();
      expect(material.map).toBe(first); expect(onError).toHaveBeenCalledOnce();
      await act(async () => { finish(sprite); }); expect(material.map).toBe(first);
    } finally { await renderer.unmount(); }
    expect(material.map).toBe(original);
  });

  it('changes scroll speed without rebaking or jumping the animation position', async () => {
    const { scene, material, original } = model(); const onError = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<SkinPartPatterns scene={scene} edits={[edit()]} onError={onError} />);
    try {
      await bake(); const texture = material.map!;
      await renderer.advanceFrames(1, 1); const before = texture.offset.clone();
      await renderer.update(<SkinPartPatterns scene={scene} edits={[edit(0, 2)]} onError={onError} />);
      expect(material.map).toBe(texture); expect(texture.offset).toEqual(before);
      await renderer.advanceFrames(1, .25);
      expect(texture.offset.x - before.x).toBeCloseTo(.25 * 2 * .08);
      await bake(); expect(previewTrippySprite).toHaveBeenCalledOnce();
    } finally { await renderer.unmount(); }
    expect(material.map).toBe(original);
  });

  it('restores the previous scene on a form switch and cancels unfinished work when the pattern is removed', async () => {
    const first = model(), next = model(), onError = vi.fn(), onPending = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<SkinPartPatterns scene={first.scene} edits={[edit()]} onError={onError} onPending={onPending} />);
    try {
      await bake(); const applied = first.material.map!; const dispose = vi.spyOn(applied, 'dispose');
      let finish!: (value: TrippySpriteResult) => void;
      vi.mocked(previewTrippySprite).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await renderer.update(<SkinPartPatterns scene={next.scene} edits={[edit()]} onError={onError} onPending={onPending} />);
      expect(first.material.map).toBe(first.original); expect(dispose).toHaveBeenCalledOnce();
      await bake();
      await renderer.update(<SkinPartPatterns scene={next.scene} edits={[]} onError={onError} onPending={onPending} />);
      await act(async () => { finish(sprite); });
      expect(next.material.map).toBe(next.original); expect(onError).not.toHaveBeenCalled();
      expect(onPending).toHaveBeenLastCalledWith('coat.vmat', false);
    } finally { await renderer.unmount(); }
  });
});
