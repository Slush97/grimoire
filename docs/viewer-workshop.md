# Viewer and appearance workspace

## Color adjustment and save flow

Keep the V2 horizontal part strip and selected-part inspector. A stack of full
texture cards repeats every control and makes identifying a small accessory take
too much scrolling. Thumbnails belong in the strip and inspector header; source
dimensions come from the installed VTEX header, rather than the reduced preview.

Use the existing surface tokens #0f0f0f, #1a1a1a, #242424 and border #2d2d2d.
Keep Radiance for controls, Reaver for the hero title and the runtime accent for
selection. The only fixed palette colors are selectable paint swatches.

```text
  Skin [Default]      Original | Edited   Reset   Export   [Skin name] Save & enable
  eye Book [texture]  eye Coat [texture]  eye Gun [texture] ...
  +--------------------------------------+ +--------------------------+
  |                                      | | [texture] Coat    Reset   |
  |                                      | | 2048 x 2048               |
  |           live model                 | | Color | Pattern           |
  |                                      | | Hue          slider value |
  |                                      | | Saturation   slider value |
  |                                      | | Brightness   slider value |
  |                                      | | Tint             Colorize |
  |                                      | | swatches / picker / hex   |
  |      camera / playback / capture      | |                           |
  +--------------------------------------+ +--------------------------+
```

The part list highlights on hover and visible keyboard focus. Mouse selection
does not pin the highlight. Editing controls leave the model's colors visible.
The inspector header and model hover do not activate highlights. Model clicks
still select a part.

Hue is a relative rotation, saturation and brightness are multipliers. They
operate on the color texture in sRGB HSV, preserving alpha. The renderer and
exporter use the same transform; texture paths remain isolated per material.
Colorize selects the material's colorize or multiply tint mode. Original resets
the preview without discarding edits; reset clears the selected part or all edits.

Save & enable creates a named local skin and enables any disabled source skins.
A lower pakNN wins, so the overlay goes directly ahead of its highest-priority
source in the enabled load order, or first when it edits the default skin. Other
mods keep their relative order, and the reorder spills into overflow folders like
any other. The overlay's metadata records `skinEdit`: the hero and the canonical
sha256 of each source. Saving again for the same hero and sources replaces that
overlay instead of adding another card; the old file goes through the normal
delete path (and mod backups, when they are on). The source check, slot
allocation, reorder and replacement run as one serialized mutation after VPK
safety inspection. Enabling and reordering can rename the sources, so the save
returns their new metaKeys and the editor carries on with the same skin and its
edits.

An overlay is never an edit source. `skinEdit` also stores the saved edits, so
when Locker links a stack that contains an overlay, the editor swaps it for the
installed skins whose sha256 it recorded (the default skin when it recorded
none), starts from those edits and replaces that overlay on save. An overlay
saved from another overlay before this rule resolves through to the original
source. Overlays saved before edits were stored start with no edits. If a
recorded source is no longer installed, the editor says so and edits the
remaining sources, keeping the saved edits that still match a part; saving
still replaces the old overlay instead of adding a second one. The Skin list
leaves overlays out.

Global skins cannot be a source. They load from the priority root, above every
add-ons folder, so an overlay would never show in game. The source list leaves
them out, and a Locker link whose equipped stack includes one opens the hero on
the default skin with a message saying so. Export still writes only to the
user's chosen file. Tests install into a task-local game directory; the user's
real mod folders are not used for these checks.

Validation includes original texture-header dimensions, preview hover/focus pixel
comparisons, exported archive CRCs, an independent HSV calculation on source
pixels and a packaged save test with a pre-existing overlay and a slot gap.
Exported entries, rather than whole archive byte order, are compared across builds.
No in-game validation or hosted CI is claimed.

## V2 editor

The first inspector repeated color/reset controls in every row and kept selected
parts tied to a hover event. That made it hard to tell which part was being edited.
V2 puts the parts in a strip above the viewer and the selected part's controls
beside the model. Keeping the list inside the inspector pushed patterns below
the fold in the first packaged check, so that layout was discarded.
The other option was inline expanding rows. That makes a long list jump when the
selection changes, so the selected-part inspector is the better fit.

```text
  All heroes   Abrams        Appearance | Abilities | Voice | Icons
  Skin [Default]                        Original | Edited    Export VPK
  eye Book   eye Coat   eye Gun   eye Head   eye Lower body   eye Teeth
  +--------------------------------------+ +--------------------------+
  |                                      | | Coat              Reset   |
  |             live model               | | Highlight part            |
  |                                      | |                           |
  |    click a piece to select it         | |                           |
  |                                      | | Color | Pattern           |
  |                                      | | picker + hex / style grid  |
  |    camera / scene / capture           | | Reset part                |
  +--------------------------------------+ +--------------------------+
```

Use bg-primary #0f0f0f, bg-secondary #1a1a1a, bg-tertiary #242424,
border #2d2d2d and text-secondary #a1a1aa. Keep the user's accent for selection
and the model highlight. Radiance controls, Reaver hero title. Keep paths and
implementation notes out of the editor. Color swatches start with the dominant
opaque albedo color rather than an invented white default. A textured part can
contain several colors; the starting swatch represents its dominant color.

The signature interaction is selecting the same part from the list or directly
on the model, with a persistent visible highlight and immediate hide/show feedback.
Patterns and recoloring apply to that part and export in the same overlay VPK.
Pattern textures are isolated per material so shared source textures do not repaint
other parts. Existing global Body + Gun tools remain available separately.

Door Stuck owns skin editing and VPK export. Locker selects installed skins and
links to the editor with the current skin stack. Both use the same model viewer.

## Placement research

Locker selects installed cosmetics and previews the enabled skin stack.
`LockerHero.tsx` already passes that stack to the shared `HeroPoseViewer`.
Door Stuck creates assets. Its `HeroWorkshop.tsx` Appearance section currently
contains `HeroEffectsPanel`, also reused by Locker and the catalog's Recolor tool.
That panel edits ability effects and procedural body paint, not arbitrary skin parts.

| Direction | Benefit | Cost |
| --- | --- | --- |
| Edit inside Locker | Current skin is already selected | Mixes equipping with creating and exporting a new mod |
| Door Stuck Appearance workspace | Creation, source selection and export have one home | Needs a route from Locker and a shared live viewer |
| Separate editor dialog | Large canvas | Adds another navigation level and hides the existing tools |

Choose Door Stuck. Locker gets an Edit skin action carrying its current source stack.
The viewer owns scene/camera presentation; Appearance owns edits and exports.

```text
Door Stuck / hero / Appearance
  Source skin                     [Original] [Edited]
  +-----------------------------+ +------------------+
  |                             | | Parts     Search |
  |          live hero          | | eye name   tint   |
  |                             | | eye name   tint   |
  | scene / playback / capture  | | Reset   Export VPK|
  +-----------------------------+ +------------------+
  Existing ability and procedural-paint controls
```

On narrow windows the inspector sits below the canvas. Keep the hero as the visual
focus. The signature interaction is immediate visibility and tint changes beside the
same animated skin, with a single Original/Edited switch for comparison.

Use existing tokens: bg-primary #0f0f0f, bg-secondary #1a1a1a, bg-tertiary #242424,
text-primary and border from index.css. Accent remains user-selected. Radiance labels,
Reaver page titles, monospace only for source paths. Reuse Select, Input, Button,
IconButton and SegmentedControl. No new decorative colors or fonts.

## V1 design (superseded by V2)

The viewer is for players adjusting a skin, with the model and its parts visible
together. Two layouts were considered: selecting a part to open a separate settings
card, or keeping visibility and color directly on each row. The second keeps simple
edits to one click and avoids a mostly empty details card for two-part skins.

```text
  Original | Edited                  Parts     2 changes
  +----------------------------+     Search parts
  |                            |     eye  part name  tint reset
  |        live model          |     eye  part name  tint reset
  |                            |
  | scene / playback / capture |     Reset all      Export VPK
  +----------------------------+     export instructions
```

Use bg-primary #0f0f0f, bg-secondary #1a1a1a, bg-tertiary #242424,
border #2d2d2d, and text-secondary #a1a1aa from the existing tokens. Use Radiance
for controls and Reaver for the existing hero title. Accent stays user-selected.
The signature is a model part outlined while its row is hovered or focused.
Keep comparison above the model so it cannot overlap scene status. Changed rows
and hidden rows need distinct states. Put material details behind a disclosure.

The initial idea of separate Colors and Parts tabs was rejected: both act on the
same groups, and switching tabs makes a small edit take longer. The same applies
to adding another inspector card. Keep the controls together and remove prose
that repeats what they do.

## Technical boundaries

Read the installed game and selected VPKs. Write generated previews to the app cache,
and exports only to a destination selected by the user. Do not alter source VPKs.
The pinned v0.24.0 vpkmerge help confirms generic KV3 JSON decoding via
soundevents, textured model export, draw-call inspection, material removal and VMAT
vector edits. Hideout support additionally needs the local `fix/map-viewer-uvs`
exporter branch: auxiliary vertex formats and streams, environment vertex paint,
and first-layer environment texture slots. The refinement also adds a read-only
texture-hdr command for linear HDR texture export with a size limit.
The local build bundles that patched executable. A vpkmerge release and a real
version/hash pin update are required before publishing this Grimoire change.

The hideout is real geometry from maps/dl_hideout.vpk, loaded on demand. Map lighting,
animation, particles and aggregate instance streams have separate support limits;
report omissions rather than inventing assets. Preview lighting remains approximate.
Generated game assets stay in the local cache.

Parts are authored material groups. Shared materials affect all matching meshes.
Tint controls require a static PBR color-tint parameter; expression-driven and
unsupported shaders keep visibility controls but disable tinting.
Exports must re-resolve the same skin stack, reject stale sources and unknown parts,
and retain selected original skins as dependencies. Export is separate from installing.

The hideout loader reads the map's player spawn and facing, world-node transforms,
aggregate primitive transforms and tints. It checks generated GLB header lengths,
reports missing exports and omits unresolved materials. Scene files participate in
the existing preview-cache size and clear controls. The cache key covers the map,
the base pak and the vpkmerge version. A build with a failed export is returned
but not saved, so the next load retries that export and reuses the GLBs that worked.

Hideout lighting uses the installed map's DC irradiance atlas and TEXCOORD_3,
including the world UV scale. HDR values survive export; the atlas is reduced to
2048 pixels on its longer side. Baked surfaces exclude studio ambient lighting.
The nearest contributing map lamps supply position, color, intensity and range,
with a maximum of twelve lights. They currently use point-light proxies, so barn,
rectangular and cone shapes, cookies and color-temperature modes are approximate.
Shadows update for the two strongest lights; other room shadows are cached.
The hero receives ambient light and reflections captured inside the loaded room.
Directional SH lightmap terms, stationary shadow masks, exact lamp shapes,
layer blending, dynamic props and map effects are still unsupported. This is an
improved local preview, not matching proof against an in-game capture.
