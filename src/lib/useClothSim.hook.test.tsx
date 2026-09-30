import { useFrame } from '@react-three/fiber';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseFeModel, type ClothModel } from './feModel';
import { CLOTH_TIMESTEP, useClothSim } from './useClothSim';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function makeRig() {
  const root = new THREE.Group();
  const anchor = new THREE.Bone();
  const tip = new THREE.Bone();
  const end = new THREE.Bone();
  anchor.name = 'anchor';
  tip.name = 'tip';
  end.name = 'end';
  tip.position.set(1, 0, 0);
  end.position.set(1, 0, 0);
  root.add(anchor);
  anchor.add(tip);
  tip.add(end);
  root.updateWorldMatrix(true, true);
  const model = parseFeModel({
    m_CtrlName: ['anchor', 'tip', 'end'],
    m_nStaticNodes: 1,
    m_NodeInvMasses: [0, 1, 1],
    m_InitPose: [
      [0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 1, 0, 0, 0, 1],
      [2, 0, 0, 1, 0, 0, 0, 1],
    ],
    m_NodeIntegrator: [{}, { flGravity: 360 }, { flGravity: 360 }],
    m_SkelParents: [-1, 0, 1],
  })!;
  return { root, anchor, tip, end, model };
}

function Driver({ root, model, animate }: {
  root: THREE.Object3D;
  model: ClothModel | null;
  animate: (delta: number) => void;
}) {
  const step = useClothSim(root, model);
  useFrame((_, delta) => { step(delta, animate); });
  return <primitive object={root} />;
}

describe('useClothSim lifecycle', () => {
  it.each(['disabled', 'unmatched'] as const)('advances animation when cloth is %s', async (state) => {
    const { root, model } = makeRig();
    if (state === 'unmatched') root.clear();
    const animate = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <Driver root={root} model={state === 'disabled' ? null : model} animate={animate} />,
    );
    await renderer.advanceFrames(1, 1 / 30);
    expect(animate).toHaveBeenCalledExactlyOnceWith(1 / 30);
    await renderer.unmount();
  });

  it('restores cloth channels on disable and unmount while retaining animated anchors', async () => {
    const { root, anchor, tip, end, model } = makeRig();
    const animate = vi.fn((delta: number) => { anchor.position.x += delta; });
    const renderer = await ReactThreeTestRenderer.create(
      <Driver root={root} model={model} animate={animate} />,
    );
    await renderer.advanceFrames(1, 2 * CLOTH_TIMESTEP);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(anchor.position.x).toBeCloseTo(2 * CLOTH_TIMESTEP);
    expect(tip.position.y).toBeLessThan(0);

    await renderer.update(<Driver root={root} model={null} animate={animate} />);
    expect(tip.position.toArray()).toEqual([1, 0, 0]);
    expect(end.position.toArray()).toEqual([1, 0, 0]);
    expect(anchor.position.x).toBeCloseTo(2 * CLOTH_TIMESTEP);
    await renderer.advanceFrames(1, 1 / 30);
    expect(animate).toHaveBeenLastCalledWith(1 / 30);
    const anchorBeforeReenable = anchor.position.x;

    await renderer.update(<Driver root={root} model={model} animate={animate} />);
    await renderer.advanceFrames(1, CLOTH_TIMESTEP);
    expect(tip.position.y).toBeLessThan(0);
    await renderer.unmount();
    expect(tip.position.toArray()).toEqual([1, 0, 0]);
    expect(end.position.toArray()).toEqual([1, 0, 0]);
    expect(anchor.position.x).toBeCloseTo(anchorBeforeReenable + CLOTH_TIMESTEP);
  });
});
