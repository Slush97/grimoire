import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseFeModel, type ClothModel } from './feModel';
import { clothSimulationCoverage, clothTuning, createClothSimHarness, resetClothTuning } from './useClothSim';
import gigawattRaw from './__fixtures__/cloth/gigawatt_fe.json';

// Numerical regression using the complete Seven FeModel exported on 2026-09-22.
// This synthetic bind skeleton isolates settling from animation and rendering.
// The real skinned-rig comparison is available through pnpm dev:cloth.
// Gravity is disabled here because this skeleton has no Source-to-glTF axis map.

function loadFixture(): ClothModel {
  const model = parseFeModel(gigawattRaw as unknown);
  if (!model) throw new Error('gigawatt fixture is not a FeModel');
  return model;
}

function restSkeleton(model: ClothModel): THREE.Group {
  const root = new THREE.Group();
  for (const n of model.nodes) {
    const bone = new THREE.Bone();
    bone.name = n.name;
    bone.position.fromArray(n.initPos);
    bone.quaternion.fromArray(n.initRot);
    root.add(bone);
  }
  root.updateWorldMatrix(true, true);
  return root;
}

// Deterministic jittery RAF-like dt: a slow frame following a fast one is exactly
// the pacing the time-corrected Verlet velocity scale would amplify.
const JITTER = [1 / 120, 1 / 30, 1 / 60, 1 / 90, 1 / 45];

describe('cloth solver real-data rest-pose stability', () => {
  afterEach(resetClothTuning);

  it('reports decoded constraints that the preview does not yet simulate', () => {
    expect(clothSimulationCoverage(loadFixture())).toEqual({
      rods: 157,
      animatedRods: 0,
      twists: 42,
      kelagerBends: 18,
      hingeLimits: 0,
      triangles: 0,
      quads: 0,
      ropeChains: 23,
      pending: { ropeChains: 0, jiggleBones: 0 },
      integrators: { 'goal-damped': 74, raw: 0, unknown: 0 },
      decodeIssues: 0,
      featureGaps: [],
    });
  });

  it('settles damped cloth and bounds the authored undamped chains under jittery dt', () => {
    clothTuning.gravityScale = 0;
    const model = loadFixture();
    const root = restSkeleton(model);
    const harness = createClothSimHarness(root, model);
    const damped = model.nodes.filter((node) => !node.pinned && node.animVertex > 0)
      .map((node) => root.getObjectByName(node.name)!);
    const previous = damped.map((bone) => bone.getWorldPosition(new THREE.Vector3()));
    const position = new THREE.Vector3();

    let metrics = harness.metrics();
    let peakInit = 0;
    let lateDampedMotion = 0;
    // Particle-sized body contacts keep some attracted cables moving past ten
    // seconds. Check a two-second window after twenty seconds of simulation.
    for (let i = 0; metrics.simulationSteps < 2640; i++) {
      metrics = harness.step(JITTER[i % JITTER.length]);
      peakInit = Math.max(peakInit, metrics.maxDistanceFromInit);
      expect(metrics.finite).toBe(1);
      damped.forEach((bone, index) => {
        bone.getWorldPosition(position);
        if (metrics.simulationSteps >= 2400) lateDampedMotion = Math.max(lateDampedMotion, position.distanceTo(previous[index]));
        previous[index].copy(position);
      });
    }

    expect(metrics.finite).toBe(1);
    // Measure displacement between solved poses, not the Verlet history buffer:
    // goal damping can change history even when the solved position is steady.
    expect(lateDampedMotion).toBeLessThan(0.005);
    const restless = model.nodes.find((node) => node.name === metrics.maxFrameMotionNode)!;
    expect(restless.animVertex).toBe(0);
    expect(restless.damping).toBe(0);
    expect(metrics.maxFrameMotion).toBeGreaterThan(0.001);
    expect(metrics.maxFrameMotion).toBeLessThan(0.2);
    // This bounds divergence, not garment fit or visual correctness.
    expect(peakInit).toBeLessThan(50);
    harness.dispose();
  });
});
