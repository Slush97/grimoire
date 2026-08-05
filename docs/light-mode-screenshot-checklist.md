# Light-mode screenshot checklist

Use this matrix for release validation and focused before/after captures. Test once at a compact window (about 1024x720) and once wide (1440x900 or larger). Capture failures and the corrected state with the same size, route, accent, and glow.

## Theme combinations

- [ ] Light theme with Ember accent, background glow disabled, sidebar expanded
- [ ] Light theme with Amber or Cyan accent, brightest glow preset, sidebar collapsed
- [ ] System theme while the operating system resolves to light
- [ ] Keyboard focus, hover, selected, disabled, placeholder, divider, and scrollbar states on each changed surface

## Routes and persistent states

- [ ] Installed: grid, compact, list, card menus, selection mode, load-order/merged/variant/unknown/conflict badges
- [ ] Browse: Mods, Sounds, WiPs, filters, details modal, thumbnail chips, image lightbox
- [ ] Discover: populated success, empty, signed out, error, profile-thumbnail badges
- [ ] Servers: loading, populated, full, offline, connect dialog success and failure
- [ ] Locker: gallery, list, hero detail, every General category, every empty General category, image actions, import and crop flows
- [ ] Foundry: catalog, workshop Appearance, Abilities, Voice, Icons, editor dialogs, preview controls, missing hero render, missing hero name art
- [ ] Conflicts: empty, conflict groups, ignored states, destructive controls
- [ ] Profiles: create, import, export, publish, progress, success, warning, failure, destructive confirmations
- [ ] Crosshair: presets, bright and dark stage images, image-stage controls
- [ ] Autoexec: warnings, command library, launch options, code and diagnostic surfaces
- [ ] Stats: every tab, loading, empty, error, positive and negative values
- [ ] Settings: every section, nested popup, color picker, gradient picker, update states

## Popup and transient states

- [ ] Context menus and every submenu level
- [ ] Anchored filter popovers, including viewport-edge placement
- [ ] Download queue collapsed indicator, expanded queue, progress, error, cancel hover
- [ ] Mod-details previous/next navigation, media strip, lightbox, creator actions
- [ ] Confirmation and destructive dialogs
- [ ] Color and gradient pickers
- [ ] Toast info, success, warning, error, action, dismiss, and stacked states
- [ ] Import progress, success, warning, partial result, and failure states

## Pass criteria

- [ ] Structural text stays readable over bright, dark, and unavailable artwork
- [ ] Normal-size status text meets 4.5:1 contrast and includes an icon or explicit state label
- [ ] Media badges and image controls remain legible over nearly white and nearly black thumbnails
- [ ] Opening a popup does not introduce a dark-only panel, muddy shadow, or invisible divider
- [ ] Glass scrollbars remain discoverable on light artwork without painting an opaque track
