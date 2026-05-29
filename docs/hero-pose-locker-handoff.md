# Live 3D hero poses in the Locker — handoff / status

**Status:** implemented, builds + typechecks + lints clean, booted in dev. NOT committed. Visual click-through not yet done.
**Date:** 2026-05-28
**Coordination note:** another agent is implementing the same feature in parallel. This doc is the source of truth for what this branch of work did, so the two can be reconciled rather than duplicated. All grimoire changes below are uncommitted working-tree edits.

---

## What it does

Adds a **2D/3D toggle** to the per-hero Locker view (`LockerHero.tsx`, right-panel portrait, top-right button). Default stays the 2D portrait; clicking "3D" shows a live, orbitable 3D model of the hero striking their menu pose, reflecting the hero's currently-enabled skin (vanilla if none enabled).

## Why `--pose` (not the old bundled-clip viewer)

`vpkmerge model export --pose [CLIP[@FRAME]]` bakes ONE animation frame into the mesh and emits a **static** `.glb`:
- no skeleton, skin, or clips (`skins=0`, `animations=0`) — loads as plain meshes, no `SkinnedMesh`, no skin-strip hack needed
- Deadlock's `*_outline` inverted-hull AND additive `*_glow` shells are dropped (both render as a white halo as plain glTF) — kills the long-standing outline-halo bug for free
- for a skin, the menu-pose clip is mapped from `--base` (the base pak) onto the skin rig by bone name (skins ship 0 clips), so a skin VPK still poses
- sub-second per hero

Net: the renderer can use the same minimal three.js path as the merged soul-container viewer (no bundled `hornet_idle.glb`, no cross-hero clip retarget).

## vpkmerge binary state (IMPORTANT)

- `--pose` lives in vpkmerge commit `aa96f71` (+ uncommitted `mesh.rs`/`vbib.rs` BLENDWEIGHT/vec2 fixes that unblocked Dynamo & Apollo) — built/reported as **v0.6.0**.
- **v0.6.0 is UNRELEASED.** Latest published release is v0.5.0 (no `--pose`, only `--clip`).
- `scripts/fetch-vpkmerge.mjs` is still pinned to **v0.5.0**. For this try-out, a local `cargo build --release -p vpkmerge-cli` binary was hand-copied into `resources/vpkmerge/vpkmerge-linux-x86_64`.
- **GOTCHA:** `pnpm install` re-runs the postinstall fetch, sees the sha256 mismatch, and re-downloads v0.5.0 — clobbering the dev binary and breaking 3D. Do not reinstall until v0.6.0 ships.
- **To ship:** cut a real vpkmerge v0.6.0 release (commit the fixes, build linux/macos/win), then bump `fetch-vpkmerge.mjs` version + all 3 sha256s.

## Files (grimoire, all uncommitted)

New:
- `electron/main/services/heroPoseModels.ts` — runs `vpkmerge model export --pose`; `grimoire-hero:` privileged scheme; `getHeroPoseInfo` / `exportHeroPose`. Keyed per `(hero, active-skin metaKey | vanilla)` so each skin caches its own still. Mirrors `soulContainerModels.ts` (resolves skin VPK by metaKey across base addons / overflow `addonsN/` / `.disabled`).
- `src/components/locker/HeroPoseViewer.tsx` — three.js + @react-three/fiber viewer, OrbitControls from `three/examples`, auto-export on mount, bounding-box normalize/center, slow turntable, disposes on unmount. Lazy-loaded; remounted via a `hero+skin` `key`.

Modified:
- `electron/main/index.ts` — register `HERO_POSE_SCHEME` privileged + `registerHeroPoseProtocol()`
- `electron/main/ipc/portraits.ts` — `get-hero-pose-info`, `export-hero-pose` handlers
- `electron/preload/index.ts` — `getHeroPoseInfo`, `exportHeroPose` bridge
- `src/lib/api.ts` — renderer wrappers
- `src/types/portrait.ts` — `HeroPoseInfo { hasModel, mtimeMs, key }`
- `src/types/electron.d.ts` — API decls
- `src/pages/LockerHero.tsx` — `view3d` state, active-skin metaKey resolution, 2D/3D toggle button, lazy `HeroPoseViewer`

## Model-codename coverage (verified against the installed pak, 2026-05-28)

`--hero` discovery matches the body-model FILE basename (`<basename>.vmdl_c` under any `/heroes*` path, ignoring the `_vN` dir). All 38 GameBanana roster heroes pose with the local v0.6.0 build:
- **33** resolve from their panorama codename (`codenamesForHero` in `heroPortraits.ts`) — incl. Dynamo=`dynamo`, Ivy=`tengu`, Infernus=`inferno`.
- **5 diverge** and are encoded as `MODEL_CODENAME_OVERRIDES` in `heroPoseModels.ts`:

| Hero | panorama codename | model codename (override) |
|---|---|---|
| Abrams | atlas | `atlas_detective` |
| McGinnis | forge | `engineer` |
| Grey Talon | orion | `archer` |
| Mo & Krill | krill | `digger` |
| Seven | gigawatt | `gigawatt_prisoner` |

(Seven: base body model is `heroes_staging/gigawatt_prisoner/gigawatt_prisoner.vmdl_c`; plain `gigawatt` is only a particle fx model. Found by inspecting an installed Seven skin VPK's overridden entry.)

The service tries override(s) first, then panorama codenames; a hero that resolves nothing falls back to the 2D portrait in the UI.

## Validation done

- vpkmerge `--pose` works against the real installed game across the full roster (CLI sweep).
- Skin-aware path proven: posing an installed Seven skin (`addons1/pak31_dir.vpk`) via the exact service command produced a valid 16 MB GLB (3 meshes, 0 skins) in 0.31s.
- Pose GLBs inspected: `skins=0`, `animations=0`, meshes present (so no SkinnedMesh crash, outline shells gone).
- `tsc -p tsconfig.app.json` and `tsconfig.node.json` clean.
- ESLint: 0 new errors in touched files (40→39 total; the 39 are pre-existing).
- `electron-vite build` succeeds (with a dummy `GRIMOIRE_SOCIAL_BASE_URL`); `HeroPoseViewer` split into its own 36 kB lazy chunk sharing the GLTFLoader chunk.
- Electron app boots clean in `pnpm dev` (main-process wiring loads, no startup errors).

## Open items

1. Manual visual click-through (Locker → hero → "3D") — not automatable from the agent.
2. Release vpkmerge v0.6.0 + re-pin `fetch-vpkmerge.mjs`.
3. Then commit the grimoire feature.

## Notes for reconciling with the parallel agent

- The merged soul-container slice (`soulContainerModels.ts` + `SoulContainerViewer.tsx`, scheme `grimoire-soul:`) is the template this followed; keeping the hero-pose slice structurally parallel is intentional.
- If the other agent revived the old `feat/3d-model-vpk-merge` branch's `HeroModelViewer` (808 lines, bundled `hornet_idle.glb` animation, cross-hero retarget): that is the SUPERSEDED approach. The `--pose` static-still approach here is simpler and fixes the outline halo. Prefer it for stills; the animated viewer is a separate, heavier feature.
