import * as THREE from 'three';

/** What three keeps for a material; `isReady` polls the parallel compile extension without blocking. */
type MaterialProgram = { currentProgram?: { isReady(): boolean } };
type Program = { isReady(): boolean };

/** Links the programs `root` draws with (for the post pipelines' half-float target, as HeroPrecompile)
 *  without waiting on them, and returns those still linking. */
function compilePending(gl: THREE.WebGLRenderer, root: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera): Set<Program> {
  const pending = new Set<Program>();
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const previous = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    for (const material of gl.compile(root, camera, scene)) {
      const program = (gl.properties.get(material) as MaterialProgram).currentProgram;
      if (program && !program.isReady()) pending.add(program);
    }
  } catch {
    // A failed compile draws anyway, where the error is reported as before.
  } finally {
    gl.setRenderTarget(previous);
    target.dispose();
  }
  return pending;
}

/** Calls `done` once every program is linked. */
function whenLinked(programs: Set<Program>, disposed: () => boolean, done: () => void): void {
  const check = () => {
    if (disposed()) return;
    for (const program of programs) if (program.isReady()) programs.delete(program);
    if (programs.size) setTimeout(check, 10);
    else done();
  };
  check();
}

/**
 * Keeps an effect's first draw from linking programs synchronously, which stalls the canvas (and a loaded
 * room) for seconds:
 *
 * - A new effect (`track`) is hidden until its own programs are linked. One whose programs exist draws at
 *   once.
 * - A new three.js light (ParticleLightRenderer.deferNewLights) is shown once the scene's programs are
 *   linked for it: every lit program is keyed on the scene's light count. The lights are shown for the
 *   compile only, so the scene keeps drawing with the programs it has meanwhile.
 *
 * While the scene is lit by a map (`userData.source2MapLit`, set by HideoutScene) the lights stay hidden:
 * map-lit materials take every light from the map's light model, and a three.js light only displaces it.
 */
export class ParticleProgramWarmup {
  private readonly fresh: THREE.Object3D[] = [];
  private warmingLights = false;
  private disposed = false;

  track(effect: THREE.Object3D): void {
    this.fresh.push(effect);
  }

  /** Call each frame once the effects have updated, before the frame draws. */
  update(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, effects: THREE.Object3D): void {
    for (const effect of this.fresh.splice(0)) {
      const pending = compilePending(gl, effect, scene, camera);
      if (!pending.size) continue;
      effect.visible = false;
      whenLinked(pending, () => this.disposed, () => { effect.visible = true; });
    }
    if (this.warmingLights) return;
    const mapLit = scene.userData.source2MapLit === true;
    const lights: THREE.Light[] = [];
    effects.traverse((object) => {
      if (!(object instanceof THREE.Light)) return;
      if (mapLit) {
        object.visible = false;
        object.userData.awaitingPrograms = true;
      } else if (object.userData.awaitingPrograms) lights.push(object);
    });
    if (!lights.length) return;
    this.warmingLights = true;
    for (const light of lights) light.visible = true;
    const pending = compilePending(gl, scene, scene, camera);
    for (const light of lights) light.visible = false;
    whenLinked(pending, () => this.disposed, () => {
      this.warmingLights = false;
      // A map lit the scene meanwhile: the next update keeps the lights hidden.
      if (scene.userData.source2MapLit === true) return;
      for (const light of lights) {
        light.visible = true;
        delete light.userData.awaitingPrograms;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
  }
}
