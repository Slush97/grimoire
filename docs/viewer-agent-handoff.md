# Continue the Grimoire viewer

This is the current handoff, dated 2026-09-30. It supersedes the missing-fixture status in the earlier cloud checkpoint. Continue implementation in the production viewer, with the reference at https://deadlockskins.gg/items/default-mirage. The goal remains comparable or better appearance and practical viewer feature parity, with short control labels and no subtitles or eyebrow copy. Do not claim parity from numerical tests alone.

## Source and workspace

- Writable repository: https://github.com/oldreceipt/grimoire, branch `feat/viewer-parity`.
- Current checkout: `/workspace/scratch/6af22c6f1513/grimoire`. Preserve it and its ignored fixtures. Do not reset or reclone an existing checkout. The handoff message supplies the final commit SHA separately.
- Original continuation head: `6a5b4a8933dca4d09955e8c98276331a296d3b9d`. Previous completed cloud head: `ba28c0f8536aae5818208d5371f8f43e4401a285`.
- Sibling: `../grimoire-social`, revision `efffe0b92a49d6cc8d82406d6fc163c2fd3662a5`.
- Read `AGENTS.md`, `docs/ui-conventions.md`, `docs/viewer-reference-audit.md`, `docs/viewer-color-pipeline.md`, `docs/viewer-npr-lighting.md`, and the original `docs/codex-cloud-handoff.md` for setup background.
- No em dashes, hardcoded renderer copy, telemetry, public fixtures, PR, merge or deployment. Use primitives, tokens and i18n. Never name a branch `codex/`. The original task authorized bounded subagents for implementation/review. Commit reviewable changes on the feature branch.

The source GitHub app can write this fork. Shell Git fetch works for the public source repository. Shell credentials for the private fixture repository remain absent; the app's text readers cannot retrieve the large binary parts. Do not ask for a token in chat or make the private repository public.

## Fixtures: actually available now

The user supplied an authorized temporary signed release-asset download. It succeeded. The full ZIP SHA256 was independently verified as:

```text
e4679017a8f8d6f744c5e9826c13c678cd1f88729046aa5cc59d8dc092da02f0
```

All 25 individual hashes from `viewer-fixtures-manifest.json` also passed before extraction. Only ignored `.codex-run/source2-physics/` inputs were restored. The verified ZIP is currently `/tmp/viewer-fixtures-full.zip`; temporary storage can disappear between sessions. Never persist the signed URL in code, docs, logs or public commits.

Four real cases are present: Dynamo, Yamato, Wraith and Mirage. Each has `metadata.json`, `model-viewer.glb`, `model-posed.glb`, `cloth.json` and `clips.json`. Wraith additionally has `effect.json` and three decoded effect textures. `cases.json` is the index. `delivery-manifest.json` records verified member hashes; the fixture server generates `fixture-pack-manifest.json`.

Models were exported with vpkmerge 0.19.1 at `2026-09-30T02:22:18` through `02:22:35Z`. Their source VPK directory SHA256 is `e0b3bf23741a909ebe625c83f78378cd7b047477933bccba982902c38491d746`. Mirage uses `models/heroes_staging/mirage_v2/mirage.vmdl_c`. Use the metadata's actual selectors and clips when comparing.

Run from the existing checkout:

```bash
export PATH=/tmp/grimoire-toolchain/node_modules/.bin:$PATH
node scripts/preview-cloth.mjs --serve-only --grimoire
```

The server binds only `127.0.0.1:5176`; a server was left running at handoff. Open `/hero-preview.html?case=mirage`, or substitute `dynamo`, `wraith`, `yamato`. It validates four cases and 25 files. The harness changes only Electron asset transport; production materials, mixer, cloth, particles and controls run unchanged. It needs no installed game or re-export. The full pack omits duplicate `model.glb`, so the separate legacy cloth HTML testbed cannot load unchanged. Use `model-viewer.glb` in numerical tooling rather than treating that omission as a broken fixture.

Synthetic files were moved to `.codex-run/synthetic-fixtures` and are not real hero evidence. If a new agent gets a fresh workspace, source Git alone does not carry fixtures, screenshots or ignored reports. Obtain the private ZIP through authorized delivery again, verify it, then restore only the ignored asset paths. The private workaround repository is `oldreceipt/grimoire-viewer-fixtures`; it contains ordinary Git parts and a hash-verifying restore script, no LFS. A refreshed signed link is needed if the earlier one has expired.

## Implemented code

- Timeline seeking pauses playback and resets discontinuous cloth/particle history. Resume starts from the selected pose. Time/speed inputs are bounded. Clips retain authored names and are grouped. Actual `run355`/`run275` speed suffixes now group under Movement.
- Controls stay mounted while static/animated/cloth mode changes reload the model. Pause, speed, auto-rotation, orbit/pan/zoom keys, reset, fullscreen and PNG capture are present. Cloth mode still reloads and restarts animation.
- Local PNG/JPEG/nonanimated WebP backgrounds have predecode header validation, 12 MiB/16 megapixel/8192-pixel limits, cover cropping, cancellation and owned texture/URL cleanup. Transparent mode supports alpha PNG capture.
- Material correction follows sourced MatrixColorCorrect2 contrast pivot and contrast/brightness/saturation order. Guarded schema-2 tint conversion occurs once and is applied after correction through masks. Vertex placement, detail ordering, mask defaults and shared texture ownership were corrected. Rim/transmission normal-light comparisons now use matching coordinate spaces.
- Cloth keeps the existing constraint kernels and 120 Hz fixed clock, with recovery from suspension/teleports/invalid output and malformed graph guards.
- Particles support bounded timed emission, sphere bounds/velocity, local/world offsets, rotation locking, movement/drag, fade/color curves and pause/speed. The latest change supports Wraith's authored child orbit operator. Shared attachment resolution now reports fallback or missing attachment via the concise partial-support status. The effect export cache was invalidated for corrected extraction.

Core files are `HeroPoseViewer.tsx`, `HeroViewerToolbar.tsx`, `ViewerBackdrop.tsx`, `ParticleEffect.tsx`, `fxDescriptor.ts`, `particleAttachment.ts`, `heroViewerPlayback.ts`, `source2NprMaterial.ts`, `source2ColorCorrection.ts`, `deadlockMaterial.ts`, `useClothSim.ts`, `feModel.ts`, `heroParticleExport.ts`, and `heroPoseModels.ts`.

## Verification completed

Final code gates: typecheck, full lint, UI conventions, localization/manifest and production build passed. Full tests: 2268 passed, 3 failed, 1 skipped across 146 files. The same three failures occur at the clean original head: installed-card hero alias canonicalization, cached-tree roster detection, and new-hero title inference. Baseline: 2192 passed, 3 failed, 2 skipped. Do not suppress these failures or call the full suite completely passing. Build unresolved-import marker count is zero.

Real numerical evidence is in ignored `.codex-run/source2-physics/`:

| Area | Result | Artifacts |
| --- | --- | --- |
| Cloth | 32/32 asserted cases: four heroes, idle/run, 30/60/144/360 FPS, four seconds each. Finite output, 480 substeps, exact matching frame-rate samples, no emergency recoveries, anchor error zero; resume/seek passed. Independent animation-owned bone positions agree within `1.78e-15`, rotations within `7.30e-8` radians. | `cloth-real-validation.ts`, `.json`, `.log` |
| Materials | All 25 actual materials schema 2; 22 static tint guards accepted, three Mirage `$COLOR` overlays retain unresolved fallback. Second resolve changes no factors. Mirage's sole nonidentity contrast pivot agrees with an independent full linear PNG mean within `4.9e-12`. | `material-input-audit.json`, `material-browser-audit.json`, `material-audit-summary.json` |
| Wraith particles | Production React runtime with actual raw GLB node transforms and texture transport replaced. Authored rates/radii/lifetimes, inch-to-meter scale, axis conversion, offsets, gravity and radius spline verified. Finite bounded buffers over 121 frames. | `particle-real-validation.json`, `particle-real-validation.test.tsx`, `particle-real-vitest.config.ts` |

Wraith's authored static twist roots `sleeve_0_R`, `sleeve_0_L`, `ponytail_0` intentionally simulate rotation; only their rotation equality is excluded, their positions are checked. Cloth residual rod error up to 6.654 Source units and startup motion up to 20.278 units remain recorded. Dynamo FitMatrix reconstruction remains approximate. Missing direct joints all have authored generated-target entries. These results establish stability and ownership, not exact engine physics or rendered cloth quality.

Reproduce the retained real cloth check:

```bash
export PATH=/tmp/grimoire-toolchain/node_modules/.bin:$PATH
node --import tsx .codex-run/source2-physics/cloth-real-validation.ts
```

Material sources are pinned in the evidence docs to VRF revision `b20af3819872f010da71c74c47e79191bb070c97`. Exact compiled VTEX reflectivity is absent; current pivots use bounded linear texture means. Actual game VCS72 instructions were not decoded by the older VRF parser. Three's BRDF, calibrated IBL and preview view-Fresnel rim do not reconstruct complete game lighting. No per-hero recoloring was used.

## Rendered evidence and next work

Software WebGL2 in Chromium 153 works here. Earlier synthetic input verified playback, backgrounds, fullscreen, PNG download, background inclusion and transparent alpha corners. Real static Mirage and Dynamo rendered without page/shader errors. Their screenshots are `.codex-run/real-viewer/mirage-static.png` and `dynamo-static.png`. Mirage's coat is substantially darker than the original screenshot. This is not a complete four-hero visual signoff.

The attempted real control/screenshot run was interrupted by source HMR reloads and two automation locator mistakes. `.codex-run/real-viewer/results.json` contains incomplete/failed attempts; do not report it as passing. `mirage-idle.png` captured a reload gap and is not valid model evidence. The corrected `.codex-run/real-viewer-checks.mjs` was prepared but not rerun after the final edits. Finish it with no concurrent source edits. It caps browser RAF to 150 ms for software rendering; full-rate numerical physics is checked separately.

Priorities:

1. Finish clean rendered checks on all four: static and idle/run poses, cloth on/off, paused seek/resume, clip changes, missing/delayed sidecars, camera reset/keys, lighting presets, bloom, backgrounds, opaque/transparent PNG capture and fullscreen. Confirm nonblank screenshots and check actual pixels, not just DOM controls.
2. Inspect Wraith's face and hand effects, Dynamo emission/metal, Mirage coat/tint and Yamato hair/cloth from multiple angles. Compare supplied reference screenshots with matching poses/lighting where possible. The reference page's model previously failed to load in the in-app browser; terminal rendering of our viewer works.
3. Wraith's `ability_cast` node is absent. The historical right-hand fallback remains explicitly approximate; the supplied reference shows the other open hand. Get authored attachment metadata before claiming the correct side/local frame. Sprite sequences, atlas animation/noise zoom, ropes/models, arbitrary operators/forces and dynamic control-point providers remain unsupported. Ambient sprite preview is not full ability playback.
4. Continue supported shared fixes for VTEX reflectivity, genuine per-light NPR, scene globals/depth occlusion, game LUTs and optional authorized map imagery. Do not guess per-hero compensation or copy the reference site's protected implementation/assets.
5. Validate installed skin/mod precedence and packaged Windows Electron/native GPU behavior locally. Headless software WebGL does not establish native performance, packaged CSP behavior or in-game parity.

The supplied private reference images are currently `/workspace/scratch/6af22c6f1513/handoff/screenshots/reference-{mirage,wraith,dynamo}.png`, alongside original/earlier Grimoire images. They are not tracked source and may not follow a new workspace.

## Tooling and persistence

Node20/pnpm10 binaries are currently `/tmp/grimoire-toolchain/node_modules/.bin`. Use `export PATH=...` for a multiline shell block so every subsequent command uses that toolchain. Dependencies are already installed. Do not regenerate the lockfile from the baseline worktree. Public build environment:

```bash
export GRIMOIRE_SOCIAL_BASE_URL=https://grimoire-social.slusheliott.workers.dev
```

Headless browser:

- Playwright: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`.
- Executable: `/tmp/grimoire-chromium`, decompressed from temporary `@sparticuz/chromium@153`.
- `LD_LIBRARY_PATH=/tmp/grimoire-swiftshader`; ANGLE libraries also copied beside the executable in `/tmp`.
- Launch flags: `--no-sandbox`, `--no-zygote`, `--use-gl=angle`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`.
- All services stay on loopback. Do not publish localhost to bypass browser limitations. Temporary tools can disappear between turns; recreate them if absent.

Final check commands: `pnpm typecheck`, `pnpm lint`, `pnpm ui:check`, `pnpm i18n:check`, `node scripts/gen-locale-manifest.mjs --check`, `pnpm test`, `pnpm build`. Loopback tests need network permission; the clean baseline was run with the same permission. Current logs are `/tmp/viewer-handoff-{types,lint,tests,build}.log` and are temporary.

No fixtures, signed URLs, reference assets, private reports or screenshots are in public commits. The GitHub connector saved the code using Git tree/commit/ref operations, with identical local and remote source trees. Continue from the final supplied commit without resetting work.
