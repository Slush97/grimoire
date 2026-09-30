# Viewer cloud continuation

Checkpoint: 2026-09-30. Source branch: `feat/viewer-parity`, continuing `6a5b4a8933dca4d09955e8c98276331a296d3b9d`. The source checkout was preserved. No private game assets belong in the public repository.

Update: the later signed-download workaround succeeded. The archive hash and all 25 fixture hashes passed, and four real heroes are restored. [The agent handoff](viewer-agent-handoff.md) supersedes this checkpoint's fixture blocker and records the subsequent numerical checks and remaining rendered work.

## Implemented

- Controls stay mounted while models reload. Copy remains short. The timeline seeks while paused, seeking pauses playback, resume continues from the selected pose, speed/time inputs are bounded, and authored clips are grouped without discarding their names. Progress updates stay local to the timeline.
- Backgrounds accept local PNG, JPEG and nonanimated WebP. Dimensions are inspected before decode, with 12 MiB, 16 megapixel and 8192-pixel limits. Cover cropping follows viewport size; cancelled/replaced image loads revoke their URLs and dispose their textures. Clear and transparent capture work without an upload service.
- Shared material correction follows the sourced matrix ordering and tint conversion, with guarded exporter compatibility and no per-hero compensation. Texture ownership and camera-dependent light gate bugs are fixed. [Color evidence and limits](viewer-color-pipeline.md); [lighting evidence and limits](viewer-npr-lighting.md).
- Sprite particles support timed continuous/burst emission, sphere bounds/velocity, positional offsets, position locking, authored movement/drag, fade windows and color interpolation. The exporter handles legacy lifespan/texture fields and invalidates stale effect metadata. Unsupported operators/renderers produce a short status. Seeking or switching clips restarts ambient previews; playback pause/speed reaches the runtime.
- Cloth preserves the existing constraint kernels and fixed 120 Hz clock. It reseeds after suspension or large teleports, guards invalid animation/solver results, and rejects malformed graph references. These are preview recovery measures, not proof of game physics parity.

Particle preview remains a subset: ropes/models/atlases, arbitrary operators, forces/constraints, dynamic control-point providers and several initialization modes still need implementation. Ambient effects are not synchronized ability playback. Cloth mode changes still reload the scene and restart its animation. Compiled reflectivity, full game lighting, map scenery and color LUT reconstruction remain open.

## Checks

Node 20 and pnpm 10 were used, matching CI. Cloud setup and the pinned exporter installation completed; the public social URL was supplied for the build.

| Check | Result |
| --- | --- |
| Typecheck | Passed |
| Full source lint | Passed |
| UI conventions | Passed |
| Localization and generated manifest | Passed |
| Production build | Passed |
| Full tests | 2264 passed, 3 failed, 1 skipped |
| Clean original-head tests, same environment | 2192 passed, 3 failed, 2 skipped |

The same three failures occur on the clean original head: `getInstalledCardTaxonomy` canonicalizing hero aliases, `buildHeroList` detecting a tree predating a roster hero, and `inferHeroFromTitle` matching new heroes. They are existing roster expectations, not introduced viewer failures. Loopback-dependent tests were run with network permission on both checkouts.

The transport-only local harness mounted the production renderer in Chromium 153 using software WebGL2. A clearly marked synthetic skinned box exercised shader compilation, animated model loading with the controls left open, grouped clips, paused seeking, clip switching, resumed playback, local background load/clear, fullscreen, and PNG download. Capture pixels confirmed the selected background was included and the transparent preset retained zero-alpha corners. No page or shader errors were observed. Synthetic files and screenshots remain ignored, and are not hero comparisons. After verification, synthetic inputs were moved out of the real fixture directory to prevent accidental use as hero assets.

## Initial private fixture access blocker (resolved later)

The private upload exists, but its authorized download returned HTTP 502. The later workaround uses `oldreceipt/grimoire-viewer-fixtures`, branch `main`, with eight ordinary-Git binary parts, a manifest and `restore.py`. The GitHub app could read the manifest and restore script. Cloud shell cloning failed exactly:

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

The connector's text-oriented file/blob readers could not deliver the large binary parts; downloading the supplied temporary binary URLs returned HTTP 404. No parts were restored. The expected archive SHA256, supplied by the fixture producer, is `e4679017a8f8d6f744c5e9826c13c678cd1f88729046aa5cc59d8dc092da02f0`. This continuation has not independently verified those bytes or the 25 real fixture files.

The environment needs authorized shell read access to that private repository. After access is provided, restore into the existing checkout without resetting source work:

```bash
git clone --depth 1 https://github.com/oldreceipt/grimoire-viewer-fixtures.git /tmp/grimoire-viewer-fixtures
python3 /tmp/grimoire-viewer-fixtures/restore.py --into /workspace/scratch/6af22c6f1513/grimoire
cd /workspace/scratch/6af22c6f1513/grimoire
node scripts/preview-cloth.mjs --serve-only --grimoire
```

If `/tmp/grimoire-viewer-fixtures` still contains the downloaded text-only metadata, use another temporary clone destination and its corresponding restore path. The restore verifies all part hashes, the complete archive hash and all 25 files before extracting only ignored `.codex-run/source2-physics/` inputs. It supplies the real harness inputs. Do not commit fixtures or make the fixture repository public.

All four real heroes still need comparison for materials, cloth, particles, playback and capture. This is blocked by fixture access. Browser-based controls/capture are verified with synthetic input; Windows Electron, native GPU appearance and frame comparisons with the game/reference remain separate unverified targets. The in-app reference browser also failed to load the reference model, so it did not provide a rendered comparison in this continuation.
