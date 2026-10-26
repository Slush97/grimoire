# Hero forms in the skin editor

The form picker changes the model being edited and previewed. It never creates another skin or silently copies colors between unrelated parts. Save and export always include every form's edits.

## Design decision

This follows Claude's frontend-design skill within Grimoire's existing UI conventions: Radiance, Reaver for titles, the user's accent, common controls, and the quiet workshop layout.

Three placements were considered:

| Placement | Tradeoff |
|---|---|
| Hero navigation | Confuses a temporary form with another hero and suggests a separate save. |
| Above the part controls | Makes the form look like a material setting and separates it from the preview. |
| Attached to the preview | Keeps the model and its selected form together while retaining one source and save action. |

Use the existing preview footer for a compact Form selector. Keep source and Original / Edited above the whole workbench. Keep part tools and save in the right column. Ordinary heroes get no extra selector or footer.

```text
Skin [source]                              [Original | Edited]
+--------------------------------------+  +--------------------+
|                                      |  | Parts              |
|          Selected form               |  | Selected part      |
|                                      |  | Used in Normal, ...|
|                                      |  | Color / Pattern /  |
|                                      |  | Surface            |
+--------------------------------------+  +--------------------+
| Form [Normal 2 | Werewolf 1]          |  | Changes across     |
+--------------------------------------+  | forms              |
                                          | Save & enable      |
                                          +--------------------+
```

Counts on form choices are changed materials in that form. Shared materials appear in each affected form's count, but the save total counts each material once. The save footer explicitly says when changes span multiple forms. Switching forms preserves drafts, the selected part in each form, and separate camera views. Original compares the same form against its source.

The selected part lists every form using its material. There is no automatic palette or pattern synchronization between separate materials. A shared material remains one edit because that is how it behaves in the game.

Use the common SegmentedControl for its arrow-key navigation, focus and selected state. On narrow windows the footer wraps beneath the preview and the tools stack below it. Switching forms is disabled during export. Form availability failures stay within the selected preview, explain that edits are kept, and allow switching back. Never substitute a normal model for an unavailable form.

## Verified asset mechanisms

| Hero | Form | Representation |
|---|---|---|
| Silver | Werewolf | Separate transform model named by the ability data. |
| Calico | Cat | Separate model named by both cat-form modifiers. |
| Viscous | Goo Ball | The current hero model's `inflated` body group. |
| Viscous | The Cube | Separate cube model named by the restorative-goo modifier. |
| Ivy | Stone Form | Ability particle's model with its authored stone material override. |

The roster and ability data were audited from the installed game on 2026-10-26. Baba's pigeon and Sinclair's rabbit are target curses, so they do not belong among the caster's own forms. Other ability-created props and summons also remain outside this picker. Asset presence proves the editable resources, not an in-game acceptance test.

### In-game follow-up

Batch 1 screenshots confirm that the targeted Silver, Calico, Viscous and Ivy alternate resources apply in-game. The user also confirmed animation on Silver and Calico. Shiv's jacket stayed blue at full rage, and Yamato's Shadow Form did not display its intended gradient despite correct exported material edits. Their runtime material routes or trigger conditions remain unresolved. Local preview/export support must not be presented as full gameplay validation for these two heroes.

Shiv and Yamato have been removed from the form picker pending a verified runtime appearance and edit route. Shiv's authored `ultimate` material group does not establish a Full Rage appearance, and no current gameplay trigger for that material swap has been verified. Yamato's runtime Shadow Form also applies a status shader that the material-group preview omits, so the preview and exported material edits do not establish control over her actual form. Keep the assets available for investigation without presenting either variant as an editable gameplay form. Existing drafts are retained; edits targeting those alternate materials use the existing unknown-part protection.

## Implementation boundaries

Definitions specify a model entry and optional authored body/material group. Inspection and preview must use the same selections. Edits remain keyed by the actual material path, and the overlay retains all edits regardless of the visible form. Source skins take priority for the selected model, material groups and textures; an incompatible custom model can make a form unavailable.

Body groups select existing meshes. Material groups remap corresponding material slots on the existing rig. Preview selection never changes the installed model or forces a form during gameplay. Clip selection stays on the selected model's rig; a form without a supported animation can still display its authored static shape.

Geometry removal cannot hide a material-swapped part independently of another state of that same geometry. Disable that part's visibility control and explain the shared visibility. Shared, unchanged parts can still be hidden, subject to retaining a visible part in every form.

Missing or changed source materials retain the existing unknown-part protection. Do not discard drafts to make a save pass. Saving one skin must preserve edits in hidden forms and enable the overlay through the existing serialized mod mutation flow.
