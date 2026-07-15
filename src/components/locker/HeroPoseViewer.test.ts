import React, { type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HeroPoseFailureState,
  HeroPoseLoadingState,
  PosedModel,
  type TurntableInteraction,
} from './HeroPoseViewer';
import { resolveHeroPoseRenderFeatures } from './heroPoseRenderFeatures';

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}:${JSON.stringify(options)}` : key;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function baseFlags() {
  return {
    unified: false,
    celV2: false,
    cloth: false,
    bloom: false,
    nprDebug: false,
    matDebug: false,
  };
}

function interaction(paused = false): RefObject<TurntableInteraction> {
  return { current: { dragging: false, paused } };
}

function makeScene(): { scene: THREE.Group; material: THREE.MeshStandardMaterial } {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 4, 1);
  const colors = new Float32Array(geometry.attributes.position.count * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 2, 0);
  scene.add(mesh);
  return { scene, material };
}

describe('HeroPoseViewer fallback states', () => {
  it('renders the failure copy without mounting a Canvas', () => {
    const html = renderToStaticMarkup(
      React.createElement(HeroPoseFailureState, { message: 'cannot pose test hero' })
    );

    expect(html).toContain('cannot pose test hero');
    expect(html).not.toContain('canvas');
  });

  it('shows single-source generation copy while posing', () => {
    const html = renderToStaticMarkup(
      React.createElement(HeroPoseLoadingState, {
        generating: true,
        heroName: 'Abrams',
        skinSourceCount: 1,
        t,
      })
    );

    expect(html).toContain('locker.pose.posing');
    expect(html).toContain('Abrams');
    expect(html).not.toContain('locker.pose.posingWithMods');
  });

  it('shows stacked-mod generation copy for multi-source previews', () => {
    const html = renderToStaticMarkup(
      React.createElement(HeroPoseLoadingState, {
        generating: true,
        heroName: 'Ivy',
        skinSourceCount: 3,
        t,
      })
    );

    expect(html).toContain('locker.pose.posingWithMods');
    expect(html).toContain('&quot;count&quot;:3');
  });

  it('keeps copy hidden during non-generating loads', () => {
    const html = renderToStaticMarkup(
      React.createElement(HeroPoseLoadingState, {
        generating: false,
        heroName: 'Seven',
        skinSourceCount: 2,
        t,
      })
    );

    expect(html).not.toContain('locker.pose.posing');
    expect(html).not.toContain('locker.pose.posingWithMods');
  });
});

describe('resolveHeroPoseRenderFeatures', () => {
  it('keeps material effects off by default', () => {
    expect(resolveHeroPoseRenderFeatures(baseFlags(), false)).toMatchObject({
      source2ShaderHintsEnabled: false,
      nprMaterialsEnabled: false,
      bloomEnabled: false,
      riggedPreviewEnabled: false,
    });
  });

  it('routes unified material through Source 2 hints and NPR material gating', () => {
    const features = resolveHeroPoseRenderFeatures({ ...baseFlags(), unified: true }, false);

    expect(features.source2ShaderHintsEnabled).toBe(true);
    expect(features.source2SkipNpr).toBe(true);
    expect(features.nprMaterialsEnabled).toBe(true);
    expect(features.unifiedEnabled).toBe(true);
  });

  it('keeps unified NPR materials mounted while trippy paint owns the material maps', () => {
    const features = resolveHeroPoseRenderFeatures({ ...baseFlags(), unified: true }, true);

    expect(features.source2ShaderHintsEnabled).toBe(true);
    expect(features.source2SkipNpr).toBe(false);
    expect(features.nprMaterialsEnabled).toBe(true);
  });

  it('enables cloth and the rigged preview when the dev flag is set', () => {
    const features = resolveHeroPoseRenderFeatures({ ...baseFlags(), cloth: true }, false);

    expect(features.clothPreviewEnabled).toBe(true);
    expect(features.riggedPreviewEnabled).toBe(true);
  });
});

describe('PosedModel R3F behavior', () => {
  it('normalizes and recenters the loaded scene', async () => {
    const { scene } = makeScene();
    const renderer = await ReactThreeTestRenderer.create(
      React.createElement(PosedModel, { scene, interaction: interaction(), effect: null })
    );

    const outerGroup = renderer.scene.children[0].instance as THREE.Group;
    const innerGroup = renderer.scene.children[0].children[0].instance as THREE.Group;

    expect(outerGroup.scale.x).toBeCloseTo(0.5);
    expect(outerGroup.scale.y).toBeCloseTo(0.5);
    expect(innerGroup.position.y).toBeCloseTo(-2);

    renderer.unmount();
  });

  it('enables vertex colors for meshes that export COLOR_0', async () => {
    const { scene, material } = makeScene();
    const renderer = await ReactThreeTestRenderer.create(
      React.createElement(PosedModel, { scene, interaction: interaction(), effect: null })
    );

    expect(material.vertexColors).toBe(true);
    expect(material.version).toBeGreaterThan(0);

    renderer.unmount();
  });

  it('turns the model over R3F frames', async () => {
    const active = await ReactThreeTestRenderer.create(
      React.createElement(PosedModel, { scene: makeScene().scene, interaction: interaction(), effect: null })
    );
    const activeGroup = active.scene.children[0].instance as THREE.Group;

    await ReactThreeTestRenderer.act(async () => {
      await active.advanceFrames(1, 1);
    });

    expect(activeGroup.rotation.y).toBeCloseTo(0.25);
    active.unmount();
  });

  it('does not turn the model when interaction pauses it', async () => {
    const paused = await ReactThreeTestRenderer.create(
      React.createElement(PosedModel, {
        scene: makeScene().scene,
        interaction: interaction(true),
        effect: null,
      })
    );
    const pausedGroup = paused.scene.children[0].instance as THREE.Group;

    await ReactThreeTestRenderer.act(async () => {
      await paused.advanceFrames(1, 1);
    });

    expect(pausedGroup.rotation.y).toBe(0);
    paused.unmount();
  });
});
