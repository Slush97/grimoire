# Hero showcase animation selection

The viewer exports a bounded menu of complete actions. Gameplay graphs can
combine locomotion, aiming, casting, recoil and weapon attachments; exporting an
individual graph leaf does not reproduce that composition.
`heroAnimationCatalog.ts` keeps reviewed recipes separate from raw asset names.
Unknown clips require an explicit `standalone: true` declaration to join the menu.

## Metadata and selection

Positive metadata (`additive`, `delta`, `requiresBase`, `transition`, `rootMotion`,
`hidden`, or `standalone: false`) excludes a clip even if its name is reviewed.
For explicit model entries, the main process reads neighboring compiled NmClip
metadata through the VPK reader and bundled KV3 decoder. Flags are associated
only when frame count and duration agree. Missing metadata is not proof that a
clip is a complete action.

Default selection follows recipe order, then known neutral/relaxed idles, then
the first explicitly complete remaining action in deterministic name order.
Per-recipe alternatives are fallbacks, not duplicate options. If no complete
clip is available, the posed/2D fallback remains available. Export is bounded by
eight actions and 10,000 frames; cache versions track selection-policy changes.

Examples of default recipes:

| Hero | First choice | Playback | Reason |
| --- | --- | --- | --- |
| Dynamo | `primary_stand_idle` | Loop | Whole body and gun idle. |
| Wraith | `ui_shop_idle` | Loop | Whole body and weapon shop idle. |
| Mirage | `primary_ooc_stand_idle` | Loop | Relaxed whole-body gun stance. |
| Yamato | `ui_hero_select` | Hold | Sword-on-shoulder showcase pose. |
| Celeste | `ui_shop` | Loop | Complete shop action. |
| Rem | `ui_shop` | Hold | Showcase action with discontinuous endpoints. |
| Victor | `weapon_stand_idle` | Loop | Body and weapon idle. |
| Graves | `weapon_stand_idle` | Loop | Keeps the separately skinned hand beside the body. |

Secondary Run/Reload recipes retain short action labels. Modern renamed aliases
are scoped to the exact model and verified source filename/timing. Positive
exclusion flags remain authoritative. Held actions use `LoopOnce` with clamping;
looping is not inferred solely from an embedded legacy loop flag.

## Validation and limits

Catalog and production tests cover selection, metadata timing, aliases,
exclusions, default playback and bounded exports. Rendered acceptance should
inspect body and weapon channels at the start, middle, end and loop boundary,
including warmed cloth where applicable. A suitable base-model clip does not
prove every skin or attachment combination is valid.

The menu deliberately omits unreviewed graph layers and composites. It does not
expose the entire gameplay animation library or synchronize arbitrary ability
particle events. Reconstructing those actions requires matching masks, layer
modes, attachments and root-motion policy, not simply allowing more filenames.
