# Hero showcase animation selection

The default idle comes from the selected model's compiled UI AnimGraph2.
The old per-hero recipes remain a fallback and still supply secondary actions.
Gameplay graphs can combine locomotion, aiming, casting, recoil and attachments.
One arbitrary graph resource is not enough to reproduce that composition.

## Default priority

`heroRiggedClips.ts` reads `m_animGraph2Refs` with identifier `ui`, then resolves
the graph's node indices, state paths and resource slots. Selection follows:

1. The direct clip played by `Hero_Shop` in the root state machine.
2. The direct clip played by `Hero_Select` in that state machine.
3. The existing hero recipes, then known neutral or relaxed standing idles.
4. An explicitly complete remaining action in deterministic name order.

This follows the game's state mapping instead of guessing from filenames.
A shop state can name `ui_shop`, `ui_shop_idle`, `weapon_stand_idle`, or an
unfamiliar resource outside the model's neighboring directory. Shop wins over
hero select regardless of the order of resources or nodes in the graph.

Only a state that directly plays a `CNmClipNode` qualifies. Masked states,
weighted layers, composed roots, reverse or reset-time drivers and nonpositive
speed multipliers do not qualify. A graph variation's clip must use one of the
model's `m_vecNmSkeletonRefs` when that model declares them. This rejects
inherited references to another hero's skeleton. The selected clip must also
pass the duration, frame count, additive, root-motion and name exclusions.
Missing metadata does not establish that an arbitrary leaf is a full-body action.

The UI leaf's `m_bAllowLooping` determines playback. True repeats the clip;
false uses `LoopOnce` with clamping. A positive constant `m_flSpeedMultiplier`
scales that action's playback speed, including Nurse Harrow's 0.69 shop speed.
The export records the chosen default,
source graph, state and playback in animation `extras.grimoireShowcase`.
GLTFLoader preserves this as animation `userData`, and the production viewer
uses it before the old name recipes. Game clip names stay unchanged.

## Discovery and export

Discovery combines embedded sequences with external `.vnmclip_c` resources.
Graph resources resolve first, followed by the neighboring `clips/` directory
for reviewed secondary actions. A qualifying UI graph clip takes priority over
a same-name embedded sequence. Other actions retain their embedded source when
it is playable. External clips use their own compiled timing and flags.

Positive metadata (`additive`, `delta`, `requiresBase`, `transition`, `rootMotion`,
`hidden`, or `standalone: false`) excludes a clip even if its name is reviewed.
The embedded metadata reader associates neighboring compiled flags only when
frame count and duration agree. Its exact-model aliases remain unchanged.

The resolved resource stays attached to the selected clip through export.
External actions use `workshop motions` and bind to the model by bone name after
rig compatibility checks. Both export and cache reads require animation channels
and a duration greater than 0.001 seconds. Pipeline version 26 invalidates the
old selection and no-clip caches.

A graph idle replaces legacy idle and relaxed-idle recipes. Run, reload,
hero-pose, dash and heavy-melee recipes retain their existing selection and
playback. Equivalent options are deduplicated. The menu allows eight actions
and 10,000 frames; the animation donor has the exporter's stricter 2,400-frame
budget, so a graph default must fit that budget. If no complete action is usable,
the posed or 2D fallback remains available.

## Validation and limits

Tests cover graph state and resource resolution, loop and hold playback,
skeleton mismatches, masked and composed states, additive and root-motion
exclusions, legacy fallback, secondary actions and GLTFLoader metadata transport.
See [hero-viewer-fidelity.md](hero-viewer-fidelity.md) for the 44-hero survey results,
staged-pose fallbacks and per-clip floor offsets.

A one-frame render establishes the visible pose at that sample. It does not
prove loop boundaries, every attachment or skin, warmed cloth, or in-game
behavior. The viewer does not reconstruct graph layers, bone-follow nodes,
constraints or arbitrary ability events. Unsupported exporter behavior must be
reported rather than hidden with per-hero clip overrides.
