# Locker 3D viewer

The Locker preview combines installed model/skin sources, reviewed animations,
optional cloth and bounded ambient particles. It uses Grimoire's production
renderer and the bundled exporter rather than a separate demonstration scene.

## Loading and presentation

`heroPoseModels.ts` resolves installed-skin precedence and exports the selected
model with matching optional sidecars. Cache versions invalidate incompatible
exports. The Electron asset protocol serves cached files; loading is cancellable
and missing optional data leaves supported animation available.

`HeroPoseViewer.tsx` owns the scene and playback state. Fresh previews enable
animation, cloth, bloom and particles where supported, with auto-rotation off.
Explicit saved choices survive reloads. Controls remain mounted during model
changes, and unsupported optional capabilities do not add status subtitles.

The compact playback strip provides pause, seek, speed, camera reset, fullscreen
and local capture. Seeking pauses playback and resets discontinuous simulation
history; resume continues from the selected pose. Camera controls support mouse
orbit/zoom and keyboard orbit, pan, zoom and reset.

## Rendering boundaries

Materials use guarded exporter metadata for color correction, tint masks,
normal/roughness decoding, emission and supported glass handling. Scene lighting
is a preview approximation, not a reconstruction of the game's complete renderer.
See [color handling](viewer-color-pipeline.md) and [lighting](viewer-npr-lighting.md).

`useClothSim.ts` runs fixed-step authored constraints with recovery guards and
restores animation-owned bones on cleanup. See [physics](source2-preview-physics.md).
`ParticleEffect.tsx` and `ParticleRopes.tsx` cover bounded sprite, attachment,
skinned-snapshot and rope subsets. Unsupported providers or missing bindings are
omitted instead of replaced with hero-specific guesses.

The [animation catalog](hero-animation-selection.md) contains reviewed exported
actions rather than the complete gameplay graph. Secondary glow/dissolve
envelopes, diffuse-lit particle chains and animation-triggered model-hitbox
effects remain incomplete. Preview cloth may clip as it does in the game.

See [backgrounds](viewer-backgrounds.md), [GIF capture](viewer-gif-capture.md) and
[development and validation](viewer-development.md) for controls and checks.
