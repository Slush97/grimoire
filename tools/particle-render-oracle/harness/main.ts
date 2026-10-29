// Dev-only: draws a particle system with the three.js renderer (src/lib/particles/render) exactly as
// the render oracle drew it with VRF, reads the HDR target back, and compares it with the oracle's.
// Driven by scripts/particle-render-diff.ts, which serves the job and collects window.__result.

import * as THREE from 'three';
import type { KVObject } from '../../../src/lib/particles/kv';
import { Vector3 } from '../../../src/lib/particles/numerics';
import { ParticleSystemSimulation, type LoadedParticleSystem } from '../../../src/lib/particles/simulation';
import { ParticleSystemRenderer, type ParticleTextureEntry, type ParticleTextureInfo } from '../../../src/lib/particles/render';
import { ParticleLightRenderer } from '../../../src/lib/particles/render/lightRenderer';
import { bundleModelSource } from '../../../src/lib/particles/host/bundleSource';
import type { ParticleBundle } from '../../../src/lib/particles/host/bundle';
import { SourcePostProcess, type SourcePostSettings } from '../../../src/lib/particles/render/post/sourcePostProcess';
import { type SerializedSnapshot, deserializeSnapshot } from '../../../src/lib/particles/snapshotResource';
import type { ParticleSnapshot } from '../../../src/lib/particles/utils/snapshotBinding';

interface Job {
  system: string;
  dt: number;
  seed: number | null;
  width: number;
  height: number;
  captures: number[];
  controlPoints: { cp: number; value: number[] }[];
  frameInputs: { kind: 'position' | 'orientation'; cp: number; value: number[] }[][] | null;
  camera: { position: number[]; forward: number[]; right: number[]; up: number[]; fovY: number; near: number };
  sunColor: number[];
  formats: Record<string, string>;
  definitions: Record<string, KVObject>;
  /** Snapshots by resource path without `_c`, when the job comes from a hero particle bundle. */
  snapshots: Record<string, SerializedSnapshot>;
  /** The models and override materials C_OP_RenderModels draws, as the bundle carries them. */
  models: ParticleBundle['models'];
  materials: ParticleBundle['materials'];
  textures: Record<string, { info: ParticleTextureInfo; png: string | null; mips: string[] }>;
  oracle: Record<number, string>;
  only: number[] | null;
  post: { settings: SourcePostSettings; oraclePng: Record<number, string>; blueNoise: string | null } | null;
}

interface LightResult {
  renderer: string;
  color: number[];
  linearBrightness: number;
  brightnessScale: number;
  range: number;
  spotInnerAngle: number;
  spotOuterAngle: number;
  fallOff: number;
  position: number[];
  direction: number[];
}

interface FrameResult {
  frame: number;
  metrics: Record<string, number>;
  image: string;
  hdr: string;
  particles: { path: string; count: number }[];
  /** The state of every light the tree's light renderers keep in use, in draw order. */
  lights: LightResult[];
  post?: { isolated: Record<string, number>; endToEnd: Record<string, number>; image: string };
}

declare global {
  interface Window {
    __result?: { frames: FrameResult[]; diagnostics: string[]; skipped: string[] } | { error: string };
  }
}

async function main(): Promise<void> {
  const job = (await (await fetch('/job.json')).json()) as Job;
  const { width, height } = job;

  const textures = new Map<string, ParticleTextureEntry>();

  await Promise.all(
    Object.entries(job.textures).map(async ([path, { info, png, mips }]) => {
      let texture: THREE.Texture | null = null;
      const load = async (url: string) =>
        createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });

      if (png !== null) {
        texture = new THREE.Texture(await load(png));

        if (mips.length > 0) {
          texture.mipmaps = await Promise.all(mips.map(load));
        }
      }

      textures.set(path, { info, texture });
    }),
  );

  const source = {
    loadSystem(path: string): LoadedParticleSystem | null {
      const key = path.replace(/_c$/, '');
      const data = job.definitions[key];
      const name = `${key}_c`;
      return data === undefined ? null : { name, data, format: job.formats[name] ?? null };
    },
    loadSnapshot(path: string): ParticleSnapshot | null {
      const serialized = job.snapshots[path.replace(/_c$/, '').replace(/\\/g, '/')];
      return serialized === undefined ? null : deserializeSnapshot(serialized);
    },
  };

  const loaded = source.loadSystem(job.system);

  if (loaded === null) {
    throw new Error(`No definition for ${job.system}`);
  }

  const simulation = new ParticleSystemSimulation(loaded, source);
  const particleRenderer = new ParticleSystemRenderer(simulation, { get: (path) => textures.get(path) ?? null }, {
    sunColor: [job.sunColor[0], job.sunColor[1], job.sunColor[2]],
    models: bundleModelSource({ models: job.models, materials: job.materials } as ParticleBundle),
  });

  if (job.only !== null) {
    particleRenderer.renderers.forEach((renderer, place) => {
      renderer.enabled = job.only!.includes(place);
    });
  }

  if (job.seed !== null) {
    simulation.seedRandom(job.seed);
  }

  for (const { cp, value } of job.controlPoints) {
    simulation.renderState.setControlPointValue(cp, new Vector3(value[0], value[1], value[2]));
  }

  simulation.start();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, premultipliedAlpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 1);

  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const post = job.post !== null ? new SourcePostProcess(job.post.settings) : null;
  const ldrTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, depthBuffer: false });

  if (post !== null && job.post!.blueNoise !== null) {
    const bitmap = await createImageBitmap(await (await fetch(job.post!.blueNoise)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
    const blueNoise = new THREE.Texture(bitmap);
    blueNoise.flipY = false;
    blueNoise.colorSpace = THREE.NoColorSpace;
    blueNoise.wrapS = blueNoise.wrapT = THREE.RepeatWrapping;
    blueNoise.minFilter = THREE.LinearMipmapLinearFilter;
    blueNoise.needsUpdate = true;
    post.blueNoise = blueNoise;
  }

  const runPost = (input: THREE.Texture): Uint8Array => {
    post!.render(renderer, input, ldrTarget);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(ldrTarget, 0, 0, width, height, pixels);
    return flipRows(pixels, width, height);
  };

  const scene = new THREE.Scene();
  scene.add(particleRenderer.object3d);

  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(job.camera.fovY), width / height, job.camera.near, 1e6);
  const [px, py, pz] = job.camera.position;
  const right = new THREE.Vector3(...(job.camera.right as [number, number, number]));
  const up = new THREE.Vector3(...(job.camera.up as [number, number, number]));
  const back = new THREE.Vector3(...(job.camera.forward as [number, number, number])).negate();
  camera.matrixAutoUpdate = false;
  camera.matrixWorld.makeBasis(right, up, back).setPosition(px, py, pz);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.updateMatrixWorld = () => {};

  const frames: FrameResult[] = [];
  const last = Math.max(...job.captures);
  const dt = Math.fround(job.dt);
  let time = 0;

  for (let frame = 0; frame <= last; frame++) {
    for (const { kind, cp, value } of job.frameInputs?.[frame] ?? []) {
      const vector = new Vector3(value[0], value[1], value[2]);

      if (kind === 'position') {
        simulation.renderState.setControlPointValue(cp, vector);
      } else {
        simulation.renderState.setControlPointOrientation(cp, vector);
      }
    }

    simulation.update(dt, time);
    time = Math.fround(time + dt);
    particleRenderer.update(camera, [width, height]);

    if (!job.captures.includes(frame)) {
      continue;
    }

    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    const halves = new Uint16Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, halves);
    const ours = new Float32Array(halves.length);
    const rowLength = width * 4;

    // Read bottom row first; the oracle writes top row first
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < rowLength; x++) {
        ours[y * rowLength + x] = THREE.DataUtils.fromHalfFloat(halves[(height - 1 - y) * rowLength + x]);
      }
    }

    const oracle = new Float32Array(await (await fetch(job.oracle[frame])).arrayBuffer());
    const { metrics, image } = compare(oracle, ours, width, height);
    const result: FrameResult = { frame, metrics, image, hdr: encodeFloats(ours), particles: describe(simulation, '0'),
      lights: particleRenderer.renderers.flatMap((renderer) => (renderer instanceof ParticleLightRenderer ? renderer.lightStates : []).map((light) => ({
        renderer: renderer.constructor.name, color: [...light.color], linearBrightness: light.linearBrightness, brightnessScale: light.brightnessScale,
        range: light.range, spotInnerAngle: light.spotInnerAngle, spotOuterAngle: light.spotOuterAngle, fallOff: light.fallOff,
        position: light.position.toArray(), direction: light.direction.toArray(),
      }))) };

    if (post !== null) {
      // The oracle's own HDR frame through our post process isolates the post from the particles
      const oracleHdr = new THREE.DataTexture(flipRows(oracle, width, height), width, height, THREE.RGBAFormat, THREE.FloatType);
      oracleHdr.minFilter = oracleHdr.magFilter = THREE.LinearFilter;
      oracleHdr.colorSpace = THREE.NoColorSpace;
      oracleHdr.needsUpdate = true;
      const isolated = runPost(oracleHdr);
      const endToEnd = runPost(target.texture);
      const oraclePng = await decodePng(job.post!.oraclePng[frame], width, height);
      result.post = { isolated: compareLdr(oraclePng, isolated), endToEnd: compareLdr(oraclePng, endToEnd), image: sideBySide([oraclePng, isolated, endToEnd], width, height) };
      oracleHdr.dispose();
    }

    frames.push(result);
  }

  window.__result = {
    frames,
    diagnostics: simulation.diagnostics.entries.map((entry) => `[${entry.kind}] ${entry.system ?? ''} ${entry.message}`),
    skipped: particleRenderer.skippedRendererClasses,
  };
}

function flipRows<T extends Float32Array | Uint8Array>(pixels: T, width: number, height: number): T {
  const flipped = new (pixels.constructor as { new (length: number): T })(pixels.length);
  const row = width * 4;

  for (let y = 0; y < height; y++) {
    flipped.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  }

  return flipped;
}

async function decodePng(url: string, width: number, height: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  return new Uint8Array(context.getImageData(0, 0, width, height).data.buffer);
}

function compareLdr(a: Uint8Array, b: Uint8Array): Record<string, number> {
  let sum = 0;
  let max = 0;
  let over2 = 0;
  let active = 0;
  let activeSum = 0;

  for (let i = 0; i < a.length; i += 4) {
    let pixel = 0;

    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      pixel += d;
      max = Math.max(max, d);

      if (d > 2) {
        over2++;
      }
    }

    sum += pixel / 3;

    if (Math.max(a[i], a[i + 1], a[i + 2], b[i], b[i + 1], b[i + 2]) > 4) {
      active++;
      activeSum += pixel / 3;
    }
  }

  const pixels = a.length / 4;
  return { mae: sum / pixels, activeMae: active > 0 ? activeSum / active : 0, max, over2: over2 / (pixels * 3), active };
}

function sideBySide(images: Uint8Array[], width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width * (images.length + 1);
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const data = context.createImageData(canvas.width, height);

  images.forEach((image, column) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 4;
        const to = (y * canvas.width + column * width + x) * 4;
        data.data.set([image[from], image[from + 1], image[from + 2], 255], to);
      }
    }
  });

  // The difference of the isolated post process from the oracle, times 8
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = (y * canvas.width + images.length * width + x) * 4;
      data.data.set([0, 1, 2].map((c) => Math.min(255, Math.abs(images[0][from + c] - images[1][from + c]) * 8)).concat(255), to);
    }
  }

  context.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function describe(system: ParticleSystemSimulation, path: string): { path: string; count: number }[] {
  return [{ path, count: system.particles.count }, ...system.children.flatMap((child, i) => describe(child, `${path}.${i}`))];
}

function encodeFloats(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer);
  let binary = '';

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

// PostProcessRenderer's default curve (no volume, exposure 1), without the dither, for viewing and the LDR metrics
const TONEMAP = { shoulder: 0.15, linearStrength: 0.5, linearAngle: 0.1, toe: 0.2, toeNum: 0.02, toeDenom: 0.3, whitePoint: 16 };

function curve(x: number): number {
  const t = TONEMAP;
  return (x * (t.shoulder * x + t.linearStrength * t.linearAngle) + t.toeNum * t.toe) / (x * (t.shoulder * x + t.linearStrength) + t.toeDenom * t.toe) - t.toeNum / t.toeDenom;
}

const whitePointScale = 1 / curve(TONEMAP.whitePoint);

function tonemap(c: number): number {
  const mapped = curve(Math.min(Math.max(c, 0) * 2.8, TONEMAP.whitePoint)) * whitePointScale;
  const gamma = mapped <= 0.0031308 ? mapped * 12.92 : 1.055 * Math.pow(mapped, 1 / 2.4) - 0.055;
  return Math.min(Math.max(gamma, 0), 1);
}

function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function compare(oracle: Float32Array, ours: Float32Array, width: number, height: number): { metrics: Record<string, number>; image: string } {
  const canvas = document.createElement('canvas');
  canvas.width = width * 3;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(width * 3, height);

  let hdrAbs = 0;
  let hdrOracle = 0;
  let ldrAbs = 0;
  let ldrMax = 0;
  let deltaE = 0;
  let active = 0;
  let activeLdrAbs = 0;
  let activeDeltaE = 0;
  let overJnd = 0;

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = [tonemap(oracle[o]), tonemap(oracle[o + 1]), tonemap(oracle[o + 2])];
    const b = [tonemap(ours[o]), tonemap(ours[o + 1]), tonemap(ours[o + 2])];
    let pixelLdr = 0;

    for (let c = 0; c < 3; c++) {
      hdrAbs += Math.abs(oracle[o + c] - ours[o + c]);
      hdrOracle += Math.abs(oracle[o + c]);
      const d = Math.abs(a[c] - b[c]) * 255;
      pixelLdr += d;
      ldrMax = Math.max(ldrMax, d);
    }

    ldrAbs += pixelLdr / 3;
    const la = toLab(a[0], a[1], a[2]);
    const lb = toLab(b[0], b[1], b[2]);
    const e = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
    deltaE += e;

    if (Math.max(...a, ...b) > 1 / 255) {
      active++;
      activeLdrAbs += pixelLdr / 3;
      activeDeltaE += e;

      if (e > 2.3) {
        overJnd++;
      }
    }

    const x = i % width;
    const y = Math.floor(i / width);
    const row = y * width * 3;
    const put = (column: number, rgb: number[]) => {
      const p = (row + column * width + x) * 4;
      pixels.data[p] = rgb[0] * 255;
      pixels.data[p + 1] = rgb[1] * 255;
      pixels.data[p + 2] = rgb[2] * 255;
      pixels.data[p + 3] = 255;
    };

    put(0, a);
    put(1, b);
    put(2, [Math.min(1, (Math.abs(a[0] - b[0]) * 4)), Math.min(1, Math.abs(a[1] - b[1]) * 4), Math.min(1, Math.abs(a[2] - b[2]) * 4)]);
  }

  context.putImageData(pixels, 0, 0);
  const count = width * height;

  return {
    metrics: {
      hdrMae: hdrAbs / (count * 3),
      hdrRelative: hdrOracle > 0 ? hdrAbs / hdrOracle : 0,
      ldrMae: ldrAbs / count,
      ldrMax,
      meanDeltaE: deltaE / count,
      activePixels: active,
      activeLdrMae: active > 0 ? activeLdrAbs / active : 0,
      activeDeltaE: active > 0 ? activeDeltaE / active : 0,
      overJnd: active > 0 ? overJnd / active : 0,
    },
    image: canvas.toDataURL('image/png'),
  };
}

main().catch((error: unknown) => {
  window.__result = { error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) };
});
