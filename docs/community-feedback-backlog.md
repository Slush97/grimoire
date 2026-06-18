# Community feedback backlog

Scoping notes for feature requests filed by the community (mostly via GitHub
issues). Each entry records what exists today, what's missing, and a rough
difficulty so the work can be picked up without re-investigating.

Status legend: **Shipped** / **Planned** / **Deferred**.

## Locker + Browse batch (issues #207-#210, June 2026)

All four were filed by one user (Minenash) in a single burst of feedback.

### #207 - Hide heroes with no content in the Locker - Shipped

Branch `feat/locker-hide-empty-and-quick-install`. In-Locker toolbar toggle
(persisted to `localStorage` `lockerHideEmpty`, alongside `lockerViewMode`)
that hides hero cards with no assigned skins/sounds. Favorited heroes stay
visible. Reuses the exact "has content" expression the hero sort already uses
in `Locker.tsx`, so what's hidden matches what sorts to the bottom. The
hero-count stat reflects the filtered list. i18n keys under `locker.page.*`.

### #209 (part 1) - Archived files shouldn't force the details modal - Shipped

Same branch. `handleQuickDownload` in `Browse.tsx` filtered to live
(non-archived) files before the "more than one file?" decision, falling back to
the full list only when every file is archived. A mod with one live file plus
archived legacy uploads now installs directly instead of opening the page.

### #209 (part 2) - Quick-install file dropdown - Deferred

Request: when a mod genuinely has multiple live files, the Install button
should open a lightweight dropdown listing file names + descriptions for a
one-click pick, instead of opening `ModDetailsModal`.

- Today: multiple live files -> `setSelectedMod(details)` opens the modal
  (`Browse.tsx` `handleQuickDownload`, ~line 2254).
- Data is already loaded (`getModDetails` returns `files[]` with name,
  description, size, `isArchived`); no extra fetch needed.
- Reuse: file-row rendering exists in `ModDetailsModal.tsx`; picker interaction
  in `MultiVpkPickerModal.tsx`.
- Missing: a new anchored-popover component (positioning, outside-click/Escape
  via the `useOverlayExit` pattern, responsive fallback to the modal), plus a
  "View all files" escape hatch. Should land as its own component per the
  Browse god-page policy.
- Difficulty: **M**. Deferred because part 1 removes most of the actual pain;
  reassess whether the dropdown is still wanted.

### #208 - Show the installed skin on the Locker card - Shipped (per-mod)

Request: the hero's Locker card should show the skin actually applied, not the
generic render, with manual image control (some poses clip with some skins).

Shipped as a **per-mod (per-skin) Locker image**, not a per-hero override (the
maintainer's call): the user picks, per skin, which image represents it in the
Locker, choosing from the mod's own GameBanana gallery (fetched on demand) or a
custom upload. The picker opens from a small image button on each skin
card/row in the Locker (`LockerModImagePicker.tsx`). The hero card / detail
backdrop shows the **active** (highest-priority enabled) skin's chosen image,
falling back to the hero render when none is set (`activeLockerSkin` in
`lockerUtils.ts`).

Storage: `userData/locker-mod-images/<encodeURIComponent(skinKey)>.<ext>`, keyed
by `getLockerSkinKey(mod)` (stable across folder/priority moves, unlike
metaKey). Gallery picks are downloaded and custom uploads copied in locally, so
the Locker stays offline-capable; both are served back as `data:` URLs (already
allowed by img-src, so no CSP change). Backend: `lockerModImages.ts` service +
`ipc/lockerModImages.ts`; store map `lockerModImages` keyed by skin key. Skin
thumbnails + the card glass backdrop honor the override; sound mods get no
picker (they keep the hero-portrait thumbnail). i18n under `locker.modImage.*`.

Possible follow-up (not built): auto pose-to-PNG of the active skin stack via
`exportHeroPose()` as a default when the user hasn't picked an image. Would need
a content-addressed cache (skin-stack hash) and to mind the packaged-3D CSP/blob
gotcha. Deferred: the manual per-skin picker already satisfies the stated need.

### #210 - Unify background art settings - Deferred

Request: fold all three background-art controls into one Appearance section,
each selectable from any hero, with the current launch art also selectable, plus
a custom image upload.

- Today, split across:
  - Settings -> Appearance: `sidebarHeroHighlight` (dynamic, any hero) via the
    hero-picker grid in `Settings.tsx` (~lines 1087-1142).
  - Sidebar `Launch Modded`/`Launch Vanilla` right-click: hardcoded
    `LAUNCH_MODDED_BG` / `LAUNCH_VANILLA_BG` in `Sidebar.tsx`; visibility lives
    in `localStorage`, not `AppSettings`.
- Plan: add ~3 `AppSettings` keys (modded/vanilla bg hero + optional custom
  image path), extend the Appearance section reusing the hero-picker grid and
  the `showOpenDialog` + `readImageDataUrl` upload flow, make the Sidebar
  backgrounds dynamic. Custom upload is simpler here than hero cards (no VPK
  build/crop, just render the file). Mind Sidebar memoization (perf-sensitive).
- Difficulty: **M**. Self-contained, heavy reuse, no backend.
