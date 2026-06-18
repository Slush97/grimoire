/**
 * Bake a hero's installed 3D skin, composited over its panorama card backdrop,
 * into a PNG and store it as that hero's Locker card image (the issue-#208
 * per-skin override slot). This is the automated alternative to picking a
 * screenshot: "Generate from installed skin".
 *
 * Snapshots are display-only. Nothing here touches the game, builds a VPK, or
 * changes in-game art; the result is a PNG written into the same local override
 * store the gallery/upload picker uses.
 *
 * INVARIANTS (see also src/lib/heroPoseScene.ts header):
 *  - ONE WebGLRenderer/context for the whole session, reused across every bake.
 *    NEVER one per hero/card: the Locker grid blew past the ~16-context cap and
 *    blanked cards white (the soul-grid bug). Hence the module-level singleton
 *    controller, NOT a per-call renderer.
 *  - Renderer matches the live viewer: ACESFilmicToneMapping, exposure 0.8,
 *    alpha:true (so a hero with no panorama art bakes onto transparency).
 *  - The IBL environment probe is renderer-bound, so it is loaded once for the
 *    shared renderer and cached for the rest of the session.
 *  - Dispose the per-bake scene + loaded GLB after each readback; keep the
 *    renderer + IBL env alive for reuse.
 *  - Backdrop aspect: card panorama art is portrait. Setting it as
 *    scene.background stretches it to the viewport, so we size the offscreen
 *    canvas to the backdrop's own W:H and frame the camera at that aspect. With
 *    no backdrop we fall back to a portrait card aspect on a transparent canvas.
 */
import * as THREE from 'three';
import {
  buildPoseScene,
  loadIblEnvironment,
  DEFAULT_CAMERA_FRAMING,
} from './heroPoseScene';
import { loadGltfPreview } from './loadGltfPreview';
import {
  getHeroPoseInfo,
  exportHeroPose,
  getHeroPanoramaBackdrop,
  getHeroPoseAuthoring,
  setLockerCardImageFromDataUrl,
} from './api';
import type {
  HeroPoseSkinSource,
  HeroPoseAuthoringMap,
} from '../types/portrait';

const HERO_POSE_SCHEME = 'grimoire-hero';

// Card portrait aspect used when a hero has no panorama art (so the bake still
// frames the figure as a tall card, not a wide letterbox). Matches the rough
// 3:4 of Deadlock's vertical hero cards.
const FALLBACK_CARD_ASPECT = 3 / 4;

// Cap the baked canvas so a very large panorama doesn't allocate an oversized
// render target; the longer edge is clamped to this and the aspect preserved.
const MAX_CANVAS_EDGE = 1024;

/** The `grimoire-hero://m/<encodeURIComponent(key)>/model.glb?v=<mtime>` URL the
 *  privileged scheme serves a hero's exported pose GLB from (see HeroPoseViewer). */
function grimoireHeroUrl(key: string, mtimeMs: number | null): string {
  return `${HERO_POSE_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
}

/** Load a PNG/JPEG data URL into a three.js texture (sRGB, ready as a background). */
function loadBackdropTexture(dataUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      dataUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err)))
    );
  });
}

/** Clamp an integer canvas size to MAX_CANVAS_EDGE while preserving aspect. */
function clampCanvasSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_CANVAS_EDGE) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = MAX_CANVAS_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Holds the single reused offscreen renderer + IBL probe for a baking session.
 * Construct once (per Locker session) and call `bakeHeroCard` for each hero;
 * call `dispose()` when the session ends to free the GL context. A single
 * controller is what keeps every bake on one WebGL context.
 */
export class HeroCardBaker {
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private envPromise: Promise<{ texture: THREE.Texture; dispose: () => void }> | null = null;
  private authoringPromise: Promise<HeroPoseAuthoringMap> | null = null;
  private disposed = false;

  private ensureRenderer(): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement } {
    if (this.disposed) throw new Error('HeroCardBaker has been disposed');
    if (this.renderer && this.canvas) {
      return { renderer: this.renderer, canvas: this.canvas };
    }
    const canvas = document.createElement('canvas');
    // alpha:true so a hero with no panorama backdrop bakes onto transparency
    // (the card surface tints it later), matching the live viewer's gl flags.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.canvas = canvas;
    return { renderer, canvas };
  }

  private ensureEnvironment(
    renderer: THREE.WebGLRenderer
  ): Promise<{ texture: THREE.Texture; dispose: () => void }> {
    if (!this.envPromise) {
      this.envPromise = loadIblEnvironment(renderer);
    }
    return this.envPromise;
  }

  private ensureAuthoring(): Promise<HeroPoseAuthoringMap> {
    if (!this.authoringPromise) {
      this.authoringPromise = getHeroPoseAuthoring().catch(() => ({}));
    }
    return this.authoringPromise;
  }

  /**
   * Bake one hero's card snapshot and store it as the active skin's Locker
   * image. `storeKey` is the per-skin override key (getLockerSkinKey of the
   * active skin); `skinSources` is the enabled visual stack for the hero (same
   * shape the live viewer feeds exportHeroPose). Throws a clear error when the
   * hero cannot be posed (e.g. clipless WIP heroes) so the caller can surface
   * or skip it.
   */
  async bakeHeroCard(
    heroName: string,
    storeKey: string,
    skinSources: HeroPoseSkinSource[]
  ): Promise<string> {
    if (this.disposed) throw new Error('HeroCardBaker has been disposed');
    const { renderer } = this.ensureRenderer();

    const authoring = await this.ensureAuthoring();
    const entry = authoring[heroName];
    const framing = entry?.camera ?? DEFAULT_CAMERA_FRAMING;
    const pose = entry?.pose;
    const modelYawDeg = entry?.modelYawDeg;

    // Ensure the posed GLB exists (export it if not). Fall back to the first
    // enabled skin's metaKey when a multi-source stack can't export, mirroring
    // the live viewer.
    const fallbackSkinMetaKey = skinSources[0]?.metaKey;
    let info = await getHeroPoseInfo(heroName, skinSources, pose);
    if (!info.hasModel) {
      info = await exportHeroPose(heroName, skinSources, fallbackSkinMetaKey, pose);
    }
    if (!info.hasModel) {
      throw new Error(`Cannot pose hero "${heroName}" (no 3D model could be exported)`);
    }

    const gltf = await loadGltfPreview(grimoireHeroUrl(info.key, info.mtimeMs));

    // Resolve the panorama backdrop (skin card art, else vanilla). Null means
    // the hero has no card art, so we bake onto transparency at a card aspect.
    let backdrop: THREE.Texture | null = null;
    let aspect = FALLBACK_CARD_ASPECT;
    let canvasWidth = Math.round(MAX_CANVAS_EDGE * FALLBACK_CARD_ASPECT);
    let canvasHeight = MAX_CANVAS_EDGE;

    try {
      const panorama = await getHeroPanoramaBackdrop(heroName, skinSources);
      if (panorama && panorama.width > 0 && panorama.height > 0) {
        backdrop = await loadBackdropTexture(panorama.dataUrl);
        aspect = panorama.width / panorama.height;
        const sized = clampCanvasSize(panorama.width, panorama.height);
        canvasWidth = sized.width;
        canvasHeight = sized.height;
      }
    } catch {
      // Backdrop is optional; fall through to a transparent card bake.
    }

    const env = await this.ensureEnvironment(renderer);

    const built = buildPoseScene({
      gltfScene: gltf.scene,
      framing,
      aspect,
      backdrop,
      environment: env.texture,
      modelYawDeg,
    });

    let dataUrl: string;
    try {
      renderer.setSize(canvasWidth, canvasHeight, false);
      renderer.setPixelRatio(1);
      built.camera.aspect = canvasWidth / canvasHeight;
      built.camera.updateProjectionMatrix();
      renderer.render(built.scene, built.camera);
      dataUrl = renderer.domElement.toDataURL('image/png');
    } finally {
      // Free the per-bake scene + GLB (and the backdrop texture, via the built
      // scene's dispose). The renderer + IBL env stay alive for the next hero.
      built.dispose();
    }

    return setLockerCardImageFromDataUrl(storeKey, dataUrl);
  }

  /** Release the shared GL context + IBL probe. Call when the session ends. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.envPromise) {
      void this.envPromise.then((env) => env.dispose()).catch(() => undefined);
      this.envPromise = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.authoringPromise = null;
  }
}
