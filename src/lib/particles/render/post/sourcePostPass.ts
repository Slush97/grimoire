// The Source 2 post process (sourcePostProcess.ts) as a pass of the postprocessing library's
// EffectComposer, for the hero viewer. It takes the composer's linear HDR buffer and writes display
// values, so it is the last pass and nothing tonemaps after it.

import { Pass } from 'postprocessing';
import type * as THREE from 'three';
import { DEADLOCK_BASE_POST, SourcePostProcess, type SourcePostSettings } from './sourcePostProcess';

export class SourcePostPass extends Pass {
  readonly post: SourcePostProcess;

  constructor(settings: SourcePostSettings = DEADLOCK_BASE_POST) {
    super('SourcePostPass');
    this.post = new SourcePostProcess(settings);
    this.needsSwap = true;
  }

  get settings(): SourcePostSettings {
    return this.post.settings;
  }

  set settings(settings: SourcePostSettings) {
    this.post.settings = settings;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null): void {
    this.post.render(renderer, inputBuffer.texture, this.renderToScreen ? null : outputBuffer);
  }

  override dispose(): void {
    this.post.dispose();
    super.dispose();
  }
}
