# Door Stuck workspace preview

Captured from the packaged Windows build on 2026-10-25 using an isolated profile and game fixture. The preview package includes the helper from [vpkmerge PR #73](https://github.com/Slush97/vpkmerge/pull/73), commit `d403627`. Shipping requires a native release and the normal three-platform hash-pin update.

Appearance and Abilities share the viewer, scrollable controls rail and fixed save actions. Drafts still save automatically; the draft-status hint was removed.

| View | Screenshot |
| --- | --- |
| Appearance color controls | [01-appearance-color.png](01-appearance-color.png) |
| Gawden gun focus and material finish | [02-material-finishes.png](02-material-finishes.png) |
| Collapsible part picker | [03-part-picker.png](03-part-picker.png) |
| Per-part patterns | [04-part-patterns.png](04-part-patterns.png) |
| Smaller window with save actions visible | [05-smaller-window.png](05-smaller-window.png) |
| Global effects | [06-global-effects.png](06-global-effects.png) |
| Reopened saved skin with its values restored | [07-resume-saved-skin.png](07-resume-saved-skin.png) |
| Viewer controls | [08-viewer-controls.png](08-viewer-controls.png) |
| Gradient dash | [09-gradient-dash.png](09-gradient-dash.png) |
| Emoji dash with illumination and outline | [10-emoji-dash.png](10-emoji-dash.png) |
| Cycling rainbow dash | [11-rainbow-dash.png](11-rainbow-dash.png) |
| Heavy-melee charge on Lash's fist | [12-heavy-melee.png](12-heavy-melee.png) |
| Generated skin and movement thumbnails | [13-generated-thumbnails.png](13-generated-thumbnails.png) |
| Open in Door Stuck in its context-menu position | [14-open-in-door-stuck.png](14-open-in-door-stuck.png) |
| Alt preview of the complete saved skin | [15-alt-skin-preview.png](15-alt-skin-preview.png) |

Validation: 3,870 app tests passed, typecheck passed, lint had zero errors (87 warnings), UI and i18n checks passed, and the production build and packaged smoke passed. The helper's Linux, Windows and macOS checks passed. Screenshots verify the packaged UI and viewer, not in-game rendering. The repaired image-trail export still needs an in-game check; movement simulation remains approximate. See [movement effects](../../door-stuck-movement-effects.md) and [material research](../../door-stuck-materials-research.md) for limits and evidence.
