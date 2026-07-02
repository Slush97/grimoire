import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseFeModel, type ClothModel } from './feModel';
import { clothTuning, createClothSimHarness, resetClothTuning } from './useClothSim';
import gigawattRaw from './__fixtures__/cloth/gigawatt_fe.json';

// Real-data rest-pose stability gate.
//
// The "never settles / flies off / clips" regression shipped because every prior
// harness test fed CONSTANT 1/60 dt over SYNTHETIC models with no colliders
// overlapping the rest pose, so the two real defects were invisible:
//   1. solveCollisions injected Verlet velocity on every contact (real nodes rest
//      INSIDE their own body capsules), and
//   2. the integrator had no velocity damping (flPointDamping is authored 0).
// This test loads a real Source 2 FeModel (gigawatt: 131 nodes, 17 capsules,
// 3 boxes) and parks the skeleton at each node's authored rest pose, so the
// animated target == rest == initPos.
//
// We run with gravity OFF (gravityScale = 0): a correct solver is then a near
// no-op (nodes only get depenetrated out of colliders once, then hold), so the
// signal is pure -- per-frame motion must decay to ~0. At the pre-fix HEAD this
// model ring-cycled forever (~0.6 cm/frame, energy pumped by collision contact)
// even with gravity off. Gravity is left out on purpose: the headless rig has no
// Z-up->Y-up mapping, so an authored-gravity sag would point sideways and only
// add a rig artifact, not signal.

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

  it('settles gigawatt at rest under jittery dt without ringing or NaN', () => {
    clothTuning.gravityScale = 0;
    const model = loadFixture();
    const harness = createClothSimHarness(restSkeleton(model), model, { substeps: 2 });

    let metrics = harness.metrics();
    let peakInit = 0;
    for (let i = 0; i < 600; i++) {
      metrics = harness.step(JITTER[i % JITTER.length]);
      peakInit = Math.max(peakInit, metrics.maxDistanceFromInit);
    }

    expect(metrics.finite).toBe(1);
    // THE fix signal: per-frame motion decays to a small residual. At pre-fix HEAD
    // this stayed ~0.75 cm/frame forever (a self-sustaining collision limit cycle
    // that never decays); the fix drops it below 0.05.
    expect(metrics.maxFrameMotion).toBeLessThan(0.05);
    // Divergence guard (not the fix signal): nodes get a one-time depenetration off
    // the colliders, then hold near it. The pre-gravity-fix checkpoint instead
    // diverged to thousands of cm. The standing offset here is rest-pose collider
    // penetration, a separate deferred follow-up, so the bound is generous.
    expect(peakInit).toBeLessThan(50);
  });
});
