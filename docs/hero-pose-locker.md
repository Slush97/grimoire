# Live 3D hero poses in the Locker

The per-hero Locker view (`src/pages/LockerHero.tsx`) shows a 2D portrait by
default and a 2D/3D toggle (top-right of the portrait panel, lg+ only). Flipping
to 3D renders a live, orbitable still of the hero in their menu pose, reflecting
the currently-enabled skin (vanilla if none is enabled).

## Why `--pose` (not an animated, skinned viewer)

`vpkmerge model export --pose [CLIP[@FRAME]]` bakes one animation frame into the
mesh and emits a *static* `.glb`:

- No skeleton, skin, or clips (`skins=0`, `animations=0`). It loads as plain
  meshes, so there is no `SkinnedMesh` and no skin-strip hack (contrast the
  soul-container path, which strips a degenerate skin; see
  `electron/main/services/soulContainerModels.ts`).
- Deadlock's `*_outline` inverted-hull and additive `*_glow` shells are dropped
  on export (both render as a white halo when loaded as plain glTF), so the
  long-standing outline-halo bug does not appear here.
- For a skin, the menu-pose clip is mapped from `--base` (the base pak) onto the
  skin rig by bone name (skins ship 0 clips), so a skin VPK still poses.
- Sub-second per hero.

Net: the renderer reuses the same minimal three.js path as the soul-container
viewer (no bundled `hornet_idle.glb`, no cross-hero clip retarget).

## Pieces

Main process:
- `electron/main/services/heroPoseModels.ts`: runs the pose export, registers
  the `grimoire-hero:` privileged scheme, exposes `getHeroPoseInfo` /
  `exportHeroPose`. Keyed per `(hero, active-skin metaKey | vanilla)` so each
  skin caches its own still. Resolves a skin VPK by metaKey across base addons,
  overflow `addonsN/`, and the `.disabled` parking lot. Concurrent identical
  exports collapse onto one vpkmerge run.
- `electron/main/index.ts`: declares `HERO_POSE_SCHEME` privileged before
  app-ready and calls `registerHeroPoseProtocol()`.
- `electron/main/ipc/portraits.ts`: `get-hero-pose-info`, `export-hero-pose`.

Bridge + types:
- `electron/preload/index.ts`, `src/lib/api.ts`, `src/types/electron.d.ts`,
  `src/types/portrait.ts` (`HeroPoseInfo { hasModel, mtimeMs, key }`).

Renderer:
- `src/components/locker/HeroPoseViewer.tsx`: lazy three.js / @react-three/fiber
  viewer. Auto-exports on mount, normalizes/centers via bounding box, slow
  turntable, OrbitControls (drag to orbit, scroll to zoom), disposes the scene
  on unmount. Remounted via a `hero+skin` `key`.
- `src/pages/LockerHero.tsx`: `view3d` state, active-skin metaKey resolution,
  the toggle button, lazy-loaded `HeroPoseViewer`.

## Requires vpkmerge v0.6.0

`--pose` only exists from vpkmerge v0.6.0 on (commit `aa96f71`), together with
the 8-influence skinning fix that unblocks Dynamo + Apollo (`e3a73ba`). Against
the v0.5.0 binary the `--pose` flag does not exist and the feature fails at
runtime. The bundled binary is pinned in `scripts/fetch-vpkmerge.mjs`
(`VPKMERGE_VERSION` + the three sha256s); it must be at v0.6.0 or later.

## Model-codename coverage (verified against the installed pak, 2026-05-28)

`--hero` discovery matches the body-model FILE basename (`<basename>.vmdl_c`
under any `/heroes*` path, ignoring the `_vN` dir). All 38 GameBanana roster
heroes pose with v0.6.0:

- 33 resolve from their panorama codename (`codenamesForHero` in
  `heroPortraits.ts`), incl. Dynamo=`dynamo`, Ivy=`tengu`, Infernus=`inferno`.
- 5 diverge and are encoded as `MODEL_CODENAME_OVERRIDES` in `heroPoseModels.ts`:

| Hero | panorama codename | model codename (override) |
|---|---|---|
| Abrams | atlas | `atlas_detective` |
| McGinnis | forge | `engineer` |
| Grey Talon | orion | `archer` |
| Mo & Krill | krill | `digger` |
| Seven | gigawatt | `gigawatt_prisoner` |

(Seven's base body model is
`heroes_staging/gigawatt_prisoner/gigawatt_prisoner.vmdl_c`; plain `gigawatt` is
only a particle-fx model. Found by inspecting an installed Seven skin VPK's
overridden entry.)

The service tries the override(s) first, then the panorama codename(s); a hero
that resolves nothing falls back to the 2D portrait in the UI.

## Storage and serving

Pose stills live at `userData/hero-poses/<sanitized-key>/model.glb`. The renderer
cannot read userData under `file://` + webSecurity, so they are served through
the privileged `grimoire-hero:` scheme as
`grimoire-hero://m/<encoded-key>/model.glb?v=<mtime>`. The key rides in the path
(under a fixed `m` host) because it contains characters a standard scheme's host
parser forbids (`::`, and a `/` for overflow skins). The `?v=<mtime>` cache-busts
the renderer URL after a re-export.

## Known limitations / follow-ups

These match the shipped `soulContainerModels.ts` behavior and are deliberately
left for a later pass:

- **No cache eviction.** Each still is ~16 MB and every `(hero, skin)` combo
  caches its own. The `hero-poses/` directory grows unbounded. A size/LRU cap
  (and/or a clear hook on skin changes) is a follow-up.
- **Stale cache on in-place skin replacement.** `getHeroPoseInfo` only checks
  that the stored GLB exists; it does not compare against the source skin VPK's
  mtime. Replacing a skin while keeping the same VPK filename leaves a stale
  pose. A source-vs-cache mtime check would close it.
- **Skin that cannot be resolved re-exports each time.** When `resolveSkinVpk`
  fails, the still is stored under the vanilla key, so the next request for that
  skin key misses the cache and re-runs vpkmerge. Edge case (skin moved/deleted)
  only.
