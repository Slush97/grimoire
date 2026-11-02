// A three.js port of ValveResourceFormat's particle renderers (MIT; see THIRD_PARTY_NOTICES.md). It
// draws a running ParticleSystemSimulation tree in Source space. See README.md for the contract with
// the host: coordinates, textures, sheets, colour spaces and lights.

export { DEADLOCK_GAME_SETTINGS, type ParticleGameSettings, type ParticleSceneDepth } from './context';
export { isRendererSupported } from './particleRenderer';
export {
  VTexFlags,
  VTexFormat,
  effectiveTotalTime,
  getSequenceIndex,
  readParticleTextureInfo,
  sequenceIdCount,
  type ParticleSheet,
  type ParticleSheetFrame,
  type ParticleSheetImage,
  type ParticleSheetSequence,
  type ParticleTextureInfo,
} from './sheet';
export { ParticleSystemRenderer, VRF_VIEWER_SUN_COLOR, type ParticleSystemRendererOptions } from './systemRenderer';
export { decodesSrgb, type ParticleTextureEntry, type ParticleTextureSource } from './textures';
