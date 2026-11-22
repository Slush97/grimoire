# Live 3D hero poses in the Locker

The per-hero Locker view (`src/pages/LockerHero.tsx`) shows a 2D portrait by
default and a live 3D toggle in the header. Flipping
to 3D renders a live, orbitable still of the hero in their menu pose, reflecting
the currently-enabled skin (vanilla if none is enabled).

## Hero layout

Back and the icon-only favorite/backdrop/viewer controls share the top row.
The larger hero logo sits beneath it between plain, fixed-position arrows, above
one transparent horizontal section selector with an accent highlight. The overlay follows the app content viewport so
warning banners cannot cover its controls. Skins,
Sounds, Cards and Effects retain their icons, counts and disabled states. The
joined `SegmentedControl` moves a single highlight between tabs, respects reduced
motion and supports arrow keys plus Home/End. Its keyboard events stay inside the
control so they cannot trigger previous/next hero navigation.

The content pane measures the visible, right-aligned hero image, including the
empty area to its left. It aims to overlap 20% of that image, capped at 38% of the
whole hero view. If the 29rem usable minimum would exceed the image target, it
falls back toward 30% of the area. If that layout covers at least half the image,
the controls fill the whole area. Preferred widths between 35% and 38% of the
area use the 38% cap to avoid slight pane changes for wider hero illustrations.
Image loads, fallback art, custom backdrops,
window resizing and sidebar changes all refresh the measurement. The frosted
backdrop stays within the options pane's width, fading inside its right edge
without extending the image coverage. It hides in full-area mode.
Skin load order stays above the skin-card grid. Two skin columns shrink down to
14rem cards, then become one column when the content is narrower than 29rem.
Both installed and upload-your-own portrait grids use the same container queries:
six columns at 39.25rem, four at 26rem, then two. Portraits shrink to about 75% of
their previous size before a pair wraps, and stay capped at 8rem after wrapping.
Each source header shows the installed mod name followed by its filename in secondary text. Both stay on one line with
ellipses; the filename hides when the name needs at least half the header width.
Icon captions use readable sentence-case text on a dark surface. Mod-card actions sit inside the thumbnail and
reuse Locker's round controls and permanent Active/shuffle/Favorite status pill.
Only the Active checkmark is accent-colored inside the pill; per-card load-order
badges and multi-VPK variant controls remain available. Skin-card actions also
open the source mod page. Variant
summaries sit to the right of the name and collapse to their chevron when the
full name and summary would not fit. Skin selection does not anchor the scroll
position to a card when active groups move to the top. Effects sub-options reuse
the compact joined selector, retaining their applied dots and draft values. The
Single Color hint sits beneath the mode selector so that selector stays in place.
Plain hero arrows have enlarged hitboxes extending slightly over the logo, while
their visible positions stay fixed. Switching tabs,
Effects surfaces and color modes replays the same `animate-slide-in-left` content
transition used by hero navigation. Reduced-motion preferences disable it.

## Why `--pose` (not an animated, skinned viewer)

`vpkmerge model export --pose [CLIP[@FRAME]]` bakes one animation frame into the
mesh and emits a *static* `.glb`:

- No skeleton, skin, or clips (`skins=0`, `animations=0`). It loads as plain
  meshes, so there is no `SkinnedMesh` and no skin-strip hack (contrast the
  soul-container path, which strips a degenerate skin; see
  `electron/main/services/soulContainerModels.ts`).
- Deadlock's NPR shells are dropped on export (they render as a white halo when
  loaded as plain glTF): the `*_outline` inverted hull, the additive `*_glow`,
  and the comic-style inked outline (`*jitter*`, e.g. Billy's
  `punkgoat_border_jitter01` on parts `*_head_jitter01`). Detection is by
  material/mesh-part name; it never inspects texture-param names, so the
  `g_tJitterMask` input on normal materials is unaffected (vpkmerge v0.6.1).
- For a skin, the menu-pose clip is mapped from `--base` (the base pak) onto the
  skin rig by bone name (skins ship 0 clips), so a skin VPK still poses.
- `--require-pose` (vpkmerge v0.6.1): a clipless WIP hero would only bake a
  static bind/T-pose, so the export errors instead and the Locker falls back to
  the 2D portrait rather than showing an unposed model. See coverage below.
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
- `FloatingModelPanel` uses the shared `FloatingPanelArea` and `useFloatingPanel`
  with the hero overlay as its viewport. It reaches the overlay edges, snaps to
  edges and center lines while Shift is held, and switches the resize grip based
  on its side of the area. User gestures have no transitions; automatic bounds
  corrections ease into place. Existing overlay-relative saved geometry is kept.

## Requires vpkmerge v0.6.0 (v0.6.1 for the pose/texture/outline fixes)

`--pose` only exists from vpkmerge v0.6.0 on (commit `aa96f71`), together with
the 8-influence skinning fix that unblocks Dynamo + Apollo (`e3a73ba`). Against
the v0.5.0 binary the `--pose` flag does not exist and the feature fails at
runtime. The bundled binary is pinned in `scripts/fetch-vpkmerge.mjs`
(`VPKMERGE_VERSION` + the three sha256s).

v0.6.1 adds three fixes the Locker depends on: deterministic hero-model
discovery (the `valve_pak` directory is a `HashMap`, so a hero with two
`<codename>.vmdl_c` such as Infernus's `inferno_v4` + old `heroes_wip/inferno`
used to resolve to a random one per export, posing or T-posing at random; it now
prefers the non-`heroes_wip` dir and highest `_vN`), `--require-pose`, and the
`*jitter*` shell drop. Bump `VPKMERGE_VERSION` + the three sha256s to the v0.6.1
release to ship them.

## Model-codename coverage (verified against the installed pak, 2026-05-28)

`--hero` discovery matches the body-model FILE basename (`<basename>.vmdl_c`
under any `/heroes*` path, ignoring the `_vN` dir). All 38 GameBanana roster
heroes resolve to a model:

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

## Hero namespace traps

Hero lookup is not one namespace. Keep the names separate when debugging pose,
shader, material, or recolor behavior:

| Namespace | Example source | McGinnis value |
|---|---|---|
| Display name | Grimoire UI, API-facing hero name | `McGinnis` |
| Panorama/class/live-materials codename | `heroPortraits.ts`, `vpkmerge model live-materials --hero` | `forge` |
| Legacy addon alias | Older community addon/card paths, `heroPortraits.ts` aliases | `engineer` |
| Current preview model entry | `MODEL_ENTRY_OVERRIDES` in `heroPoseModels.ts` | `models/heroes_wip/mcginnis/mcginnis.vmdl_c` |
| Material/recolor namespace | `heroColors.ts`, vpkmerge recolor/material recipes and paths | `mcginnis` |

McGinnis is the easy one to get wrong because Valve's old naming still leaks
into some content. For preview and material-shader debugging, use the pinned
current model entry, not `engineer`. For `vpkmerge model live-materials`, use
`--hero forge`. For VFX/material/recolor paths, expect `mcginnis` in
`models/heroes_wip/mcginnis/...` and material names.

**Six heroes resolve a model but cannot pose** (verified 2026-05-29). Their
current body model lives under `models/heroes_wip/` and bakes *zero* animation
clips into the `.vmdl_c` (the clips ship as external `clips/` files morphic does
not follow), so `--pose` can only produce a static bind/T-pose. With
`--require-pose` the export errors and the Locker shows the 2D portrait instead:

| Hero | model codename | model path |
|---|---|---|
| Apollo | fencer | `heroes_wip/fencer` |
| Billy | punkgoat | `heroes_wip/punkgoat` |
| Celeste | unicorn | `heroes_wip/unicorn` |
| Mina | vampirebat | `heroes_wip/vampirebat` |
| Paige | bookworm | `heroes_wip/bookworm` |
| Rem | familiar | `heroes_wip/familiar` |

These will start posing on their own once Valve finalizes them (moves the model
to `heroes_staging` with baked clips, as the other heroes already are) or once
morphic learns to resolve external `clips/`. No Grimoire change needed then.

## Storage and serving

Pose stills live at `userData/hero-poses/<sanitized-key>/model.glb`. The renderer
cannot read userData under `file://` + webSecurity, so they are served through
the privileged `grimoire-hero:` scheme as
`grimoire-hero://m/<encoded-key>/model.glb?v=<mtime>`. The key rides in the path
(under a fixed `m` host) because it contains characters a standard scheme's host
parser forbids (`::`, and a `/` for overflow skins). The `?v=<mtime>` cache-busts
the renderer URL after a re-export.

Each pose dir carries a `.cache-version` marker (`POSE_CACHE_VERSION` in
`heroPoseModels.ts`). `getHeroPoseInfo` reports a GLB as present only when the
marker matches; on a mismatch (or a pre-versioning GLB with no marker) the pose
is treated as absent and regenerated in place. Bump the constant whenever the
export pipeline changes in a way that invalidates cached GLBs (a bundled-vpkmerge
fix, a shell-drop rule change, or a Deadlock patch that reworks a hero), so stale
poses regenerate transparently instead of serving an old render. v2 covers the
v0.6.1 binary swap (deterministic discovery, `--require-pose`, `*jitter*` drop)
and the recent Mirage/Mina-style in-place model reworks.

## Known limitations / follow-ups

These match the shipped `soulContainerModels.ts` behavior and are deliberately
left for a later pass:

- **No *automatic* cache eviction.** Each still is ~16 MB and every
  `(hero, skin)` combo caches its own, so `hero-poses/` grows with use. Users can
  reclaim it manually via Settings -> Local preview cache -> Clear (wipes
  `hero-poses`, `soul-models`, `portrait-cache`, and `locker-card-thumbs`; see
  `electron/main/services/previewCache.ts`). An automatic size/LRU cap (and/or a
  clear hook on skin changes) is still a follow-up.
- **Stale cache on in-place skin replacement.** `getHeroPoseInfo` only checks
  that the stored GLB exists; it does not compare against the source skin VPK's
  mtime. Replacing a skin while keeping the same VPK filename leaves a stale
  pose. A source-vs-cache mtime check would close it.
- **Skin that cannot be resolved re-exports each time.** When `resolveSkinVpk`
  fails, the still is stored under the vanilla key, so the next request for that
  skin key misses the cache and re-runs vpkmerge. Edge case (skin moved/deleted)
  only.
