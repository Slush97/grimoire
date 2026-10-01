# Hero showcase animation selection

The viewer exports a small menu of complete actions. A gameplay animgraph can combine a locomotion base, aim, upper-body casting, additive recoil and weapon attachments; exporting an individual graph leaf does not reproduce that action. `heroAnimationCatalog.ts` keeps reviewed recipes separate from raw asset names. Unknown clips require an explicit `standalone: true` declaration to join this menu.

Positive metadata (`additive`, `delta`, `requiresBase`, `transition`, `rootMotion`, `hidden`, or `standalone: false`) excludes a clip even if its name is reviewed. For explicit model entries, the main process reads neighboring compiled NmClip metadata through the existing VPK reader and bundled KV3 decoder. It only associates those flags when the frame count and duration agree. Legacy embedded ANIM delta flags were all false in the inspected assets and do not establish standalone suitability. Missing modern metadata is not interpreted as proof of completeness. Basename-discovered model selectors retain the reviewed catalog fallback.

Installed base-game research on 2026-10-01 covered 68 hero definitions, 64 models with embedded clips (11,355 records), 158 graph resources and 612 selected modern clips. The following recipes were also exported with explicit current model paths and inspected in the isolated viewer. No game assets or captures belong in this repository.

| Hero | First choice | Playback | Supporting observation |
| --- | --- | --- | --- |
| Dynamo | `primary_stand_idle` | Loop | Whole body and gun, matching endpoints. `hero_pose` is a static floating pose and is a separate held choice. `ui_main_menu` has a nonzero endpoint discontinuity and is omitted. |
| Wraith | `ui_shop_idle` | Loop | Shop/info graph entry; body and weapon return to matching poses. Cloth must be enabled for the coat. `ui_hero_select` is a distinct held choice. |
| Mirage | `primary_ooc_stand_idle` | Loop | Relaxed whole-body gun stance; endpoint difference below 0.04 degrees. `ui_main_menu` is a static held choice. |
| Yamato | `ui_hero_select` | Hold | Static sword-on-shoulder showcase pose. The almost-static `primary_stand_idle` is only a fallback, not a duplicate menu choice. |
| Viscous | `ui_hero_select` | Loop | Complete ambient body motion with matching endpoints. `primary_stand_idle` reproduces the same body motion at another rate, so it is only a fallback. |
| Celeste | `ui_shop` | Loop | Modern shop graph loops it; exported body/weapon endpoints differ below 0.01 degrees. Legacy loop flag is false. |
| Rem | `ui_shop` | Hold | Whole-body pillow/candle showcase. Exported body channels differ by about 40 degrees at endpoints despite the shop graph's loop setting. Play once, then hold. |
| Victor | `weapon_stand_idle` | Loop | Stable body/weapon idle, maximum measured endpoint difference about 0.84 degrees. Modern `ui_shop` is a different, very short clip and is not substituted by name. |
| Graves | `ui_shop` | Loop | Complete body/book pose, matching endpoints and ambient movement. `weapon_stand_idle` is static and only a fallback. |

Endpoint measurements used exported skeletal, weapon and pillow translation/quaternion channels, with midpoint samples to distinguish static poses. Captures sampled start, middle, end and the loop boundary; a second pass inspected cloth after warm-up. This verifies those base-model actions, not every skin, attachment combination or future game update. The private captures use the current viewer's materials/cloth and are not an assertion of game-render parity.

Default selection follows recipe order, then known neutral standing/relaxed idles, then the first explicitly complete remaining action in deterministic name order. If none is available, existing posed/2D fallback applies. Respawn idles, aim/additive layers, transitions, split-body channels and root motion are excluded. Do not construct graph composites until the viewer can reproduce masks, layer modes, attachments and root-motion policy together.

Reviewed choices have localized short labels: Idle, Relaxed idle, Hero pose. Unknown explicitly complete names retain their descriptive words and directional suffixes. Per-recipe alternatives are fallbacks rather than duplicate options. The export remains bounded by eight actions and 10,000 frames, and its cache version changes with the selection policy.

`HeroPoseViewer.tsx` also needs the accompanying integration patch: pass the hero name to default selection and labels, and use `LoopOnce` with clamping for held recipes. That file is intentionally supplied as a separate patch because another worker owns its active playback changes.
