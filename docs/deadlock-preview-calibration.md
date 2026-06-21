# Deadlock Hero Preview Calibration

The repeatable target for the Locker 3D hero preview's "looks good" layer:
lighting, tonemapping, bloom, color space. Tune against the named heroes below,
not by eye on a random skin. Pairs with `3d-preview-fidelity-plan.md` (roadmap)
and the always-on Source 2 draw-state core (`src/lib/source2Preview/`).

## Calibration target

| Knob | Value | Source |
|---|---|---|
| Hero(es) | `inferno` (arm/head flames), `hornet` (Vindicta `ghost_glow`) | additive-overlay heroes |
| Skin / source | base `pak01_dir.vpk` (no skin VPK) | shipped Deadlock |
| Camera | position `[0, 0, 3.2]`, fov `40` | `HeroPoseViewer.tsx` Canvas |
| Tone mapping | ACES Filmic, exposure `0.8` | Canvas `gl` props |
| IBL | 6-face Radiance cubemap `public/ibl/{px,nx,py,ny,pz,nz}.hdr`, HalfFloat PMREM | `vpkmerge cubemap` of the Deadlock dusk IBL probe |
| Key light | directional `[3, 5, 4]`, intensity `1.1`, `#fff3e0` (warm) | `HeroPoseViewer.tsx` |
| Fill light | directional `[-4, 2, -3]`, intensity `0.4`, `#cfe0ff` (cool) | `HeroPoseViewer.tsx` |
| Ambient | `0.12` (IBL carries the ambient) | `HeroPoseViewer.tsx` |
| Bloom | SelectiveBloom intensity `1`, radius `0.5`, threshold `0.85` (linear), smoothing `0.2`, mipmapBlur | `BloomEffect.tsx` |
| Bloom selection | meshes whose material is self-illum or `toneMapped === false` (unlit) | `BloomEffect.isBloomMaterial` |

Source 2 Viewer (ValveResourceFormat) is the visual oracle for the same hero +
camera. No reference/Grimoire screenshots are committed yet (this environment is
headless, no GPU); capture them when validating on a workstation and link here.

## Color space (explicit, verified)

One owned path per texture role. Already correct; do not "fix" it blindly.

- Base color / emissive / self-illum color textures: `SRGBColorSpace`. GLTFLoader
  tags `baseColorTexture` / `emissiveTexture` sRGB per the glTF spec;
  `deadlockMaterial.ts` tags the transmissive + detail color maps sRGB too.
- Normal / roughness / metalness / AO / packed maps: linear (`NoColorSpace`),
  set by GLTFLoader.
- Morphic preview masks (rim/tint/outline/self-illum/jitter, the
  `userData.morphic.resolvedTextures`): `THREE.NoColorSpace` (linear data),
  forced in `resolveMorphicTextures` (vpkmerge embeds them raw, so reading them
  as sRGB would warp the per-material constants).
- IBL: HDR / linear. `HDRCubeTextureLoader` with `HalfFloatType` -> PMREM.

## Tonemapping (one ACES path, ownership transfers)

There is a single ACES Filmic look; ownership of the final tonemap transfers
with the bloom mount, so the frame is never double-tonemapped:

- Bloom OFF: the renderer owns it (`Canvas gl.toneMapping = ACESFilmicToneMapping`,
  exposure `0.8`).
- Bloom ON (the default): `@react-three/postprocessing`'s `EffectComposer`
  renders the scene with `NoToneMapping` while mounted and applies
  `<ToneMapping mode={ACES_FILMIC} />` as the last pass. The postprocessing pass
  owns the tonemap; the renderer's is bypassed.

Both are ACES Filmic, so toggling bloom does not shift the base look. If a future
change adds a second tonemap pass, collapse it here.

## Bloom object selection (left per-frame, deliberately)

`BloomEffect` re-collects the bloom-worthy meshes every frame and only re-arms
`SelectiveBloom` when the set membership actually changes (`sameMembers`). The
hero GLB loads async, so a one-shot collection can miss late-arriving meshes; the
per-frame scan with a change guard is harmless (idempotent set compare) and
robust. Per the fidelity plan, this is left as-is until there is a measured
reason to move it to a scene/compile-change trigger.

## Additive overlay round trip (verified with real data)

Local vpkmerge export against shipped `pak01_dir.vpk`, `model export --hero X
--pose`, before (bundled v0.16.0, drops glow) vs after (local glow-keeping build):

| Hero | bundled meshes | local meshes | kept overlay | overlay extras |
|---|---|---|---|---|
| `inferno` | flask_on_hip, hat, inferno | + **inferno_flames** | `inferno_armglow.vmat`, `inferno_headglow.vmat` | `blend_mode: additive`, `F_ADDITIVE_BLEND=1`, `F_SELF_ILLUM=1`, schema 2 |
| `hornet` | body, gun | + **ghost_glow** | `vindicta_glow.vmat` | `blend_mode: additive`, `F_ADDITIVE_BLEND=1`, schema 2 |

The always-on draw-state core maps `blend_mode: 'additive'` to
`AdditiveBlending` + `depthTest=true` + `depthWrite=false` + `mesh.renderOrder=10`
(unit-tested, including these exact materials). Note `self_illum_valid=false` on
these overlays (placeholder self-illum mask): the additive blend carries the
glow, so the additive rule must NOT depend on a valid self-illum mask.

## Manual visual verification steps

The data round trip is verified above and in the unit tests; the pixel-level
render needs a GPU + the running app:

1. Build the local vpkmerge CLI: `cargo build --release -p vpkmerge-cli`. Point
   Grimoire at it (replace `resources/vpkmerge/vpkmerge-windows-x86_64.exe`, or
   bump `scripts/fetch-vpkmerge.mjs` to a release that includes the glow fix).
   The GLB cache key folds `SOURCE2_EXTRAS_VERSION`/binary, so clear the hero GLB
   cache or change skins to force a regenerate.
2. `GRIMOIRE_SOCIAL_BASE_URL=... pnpm dev`, open Locker -> Inferno -> 3D preview.
3. In dev, enable the `nprDebug` Leva toggle (or
   `localStorage.setItem('grimoire.preview.nprDebug','1')` + reload). Confirm the
   console `[source2drawstate]` summary shows `additive >= 1` and a renderOrder
   distribution entry at `10`.
4. Eyeball: Inferno arm/head flames read as colored additive glow (not an opaque
   white shell); Hornet `ghost_glow` is additive; no white inverted-hull outlines
   reappear; the opaque body is unchanged.
5. Compare against a Source 2 Viewer screenshot of the same hero + camera; record
   visible deltas here.

## Notes / deltas

- The bundled released binary (`v0.16.0`) still drops glow; until a release ships
  the fix, Grimoire's default preview path needs the locally-built binary to see
  the overlays. This is the producer/consumer coupling the plan calls out.
- Bloom threshold `0.85` is tuned to catch capped self-illum + bright speculars,
  not the whole hero; additive overlays (now present) feed bloom via their
  self-illum / unlit selection.
