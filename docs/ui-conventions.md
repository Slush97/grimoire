# UI conventions

How Grimoire looks and how to build it. Read this before touching renderer UI.

## The look

A quiet workshop with one strong accent and a few deliberate serif moments. Dark by default, with a true-black OLED theme and a light theme (warm paper, not pure white) in Settings > Appearance. Deadlock's own look is art deco occult noir, so lean sharp and restrained, not glowy. When in doubt, remove decoration rather than add it.

Primitives live in `src/components/common/` (`ui.tsx`, `forms.tsx`, `PageComponents.tsx`, `Modal.tsx`, `menu.tsx`, `ToastStack.tsx`, `Skeleton.tsx`). Tokens live in `src/index.css` under `@theme`.

## Type

- **Radiance** (the body font) for all UI.
- **Reaver** (`font-reaver`, `font-mod-title`) only for page titles, modal titles and mod names. Nowhere else.
- **Mono** only for paths, hashes and code. Numbers get `tabular-nums`, not mono.
- Five sizes: `text-2xs` (11px, meta and labels), `text-xs` (12, secondary UI), `text-sm` (14, body), `text-base` (16, emphasis), `text-2xl` (24, page titles). No arbitrary `text-[Npx]`.
- No uppercase tracked micro-labels. Sentence case.
- Buttons with a single text label trim it with `text-trim-cap` (Button does this for you) because Radiance sits high in its line box.

## Color

- **Surfaces:** `bg-bg-primary` (app), `bg-bg-secondary` (cards, panels), `bg-bg-tertiary` (inputs, raised), `bg-bg-sunken` (recessed), `border-border`.
- **Tints:** translucent hover fills, hairlines and bevels use `hl/N` (`bg-hl/5`, `border-hl/10`), never `white/N`. `hl` is white on the dark themes and dark ink on the light one.
- **Wells:** a translucent recess on a token surface (code chip, inset footer) uses `shade/N` (`bg-shade/30`), never `black/N`. `shade` is black on the dark themes and a much weaker ink on the light one.
- **Text:** `text-text-primary`, `text-text-secondary`, `text-text-tertiary`. Prefer them over `text-white` (literal white stays only over imagery).
- **Accent** is user-chosen at runtime (`src/lib/accentColor.ts`); orange is only the default. It means three things: the primary action, selected, focused. Never decoration. Design against the token, never a hue.
- **Mod updates** use fixed orange `state-update`, independent of the accent. Use `Tag tone="update"` and `Button variant="update"` for update indicators and actions.
- **State** (`state-success | state-warning | state-danger | state-info`) only for real states: an error, a warning, a finished download. Not for "Active", "Valid" or "Configured" chips; plain text says those.
- **Brand** (`brand-discord | brand-kofi`) only for the brand's own buttons.
- No raw hex, no raw Tailwind palette colors (`red-500`, `zinc-300`). Add a token if something is genuinely new and reusable.

## Themes

`src/lib/theme.ts` names the themes and `applyTheme()` puts `data-theme` on the root; each theme is a block of token values in `src/index.css`. Build against the tokens and a surface works in all three.

- **Over imagery, stay dark.** Art and thumbnails sit under a dark scrim with white text in every theme, so literal `black/N` and `text-white` are right there and nowhere else. If such a region also holds token-colored children (a tag, a button, secondary text), put `always-dark` on it: in the light theme it restores the dark tokens for that subtree. The Locker hero and Global views, hero cards, 3D viewports, the crosshair stage and overlay tags do this.
- **Check both.** Look at new UI in dark and in light before calling it done. A color that only works on near-black is the usual miss.
- `light:` is a variant for the rare utility only the light theme needs (`light:invert` on a white-only icon). Reach for a token first.

## Shape and space

- **Radius:** `rounded-sm` (4px) for every rectangle: cards, inputs, buttons, icon buttons, segments, tags. `rounded-full` only for avatars, toggles and count badges.
- **Spacing:** 4px grid. Page padding 24 (`p-6`), gap between sections 32 (`gap-8`/`space-y-8`), card padding 16 (`p-4`).
- **Elevation:** borders give depth. Shadows only on floating layers (modal, menu, popover, toast).
- **Control heights:** 32px default, 28px small. `Button` and `IconButton` enforce this.
  Installed toolbar controls use 38px, including Overlap and Update.
  Browse toolbar controls use 40px.
- **z-index:** pick from the ladder at the top of `index.css`. Never invent one.

## Components

- **Buttons:** `Button` (primary, secondary, toolbar, ghost, danger, success, warning, update; sm/md; `icon`, `isLoading`) or `IconButton` (icon-only, `label` required, doubles as tooltip). One primary per view. Toolbar controls use toolbar for their neutral surface and primary when selected; text-only toolbar actions use ghost. Danger belongs in confirmations, not on every row.
- **Pick-one toggles:** `SegmentedControl`. One toggle style; no pills.
  Browse and Installed view-option menus use `ViewOptionControl` for their joined
  tabs, with matching labels, icons, and spacing.
- **Tab strips:** `MultiSelectSegments` provides the shared Browse section and
  Installed filter presentation. Callers own selection rules, including whether
  an empty selection or right-click solo selection is allowed. Installed
  dropdowns use its neutral tone, matching Browse's filter choices; Browse's
  section selector retains its accent tone.
- **Form controls:** `Input`, `Textarea`, `Select`, `DropdownSelect`, `FormField` from `forms.tsx`. `Select` uses the native option menu; `DropdownSelect` provides the shared custom menu with optional icons and search. `HeroSelect` adds hero icons to it for Browse, Installed, and Locker tagging. `DynamicSelect` sizes a native select to its selected label.
- **Overlays:** `Modal` + `ModalHeader` for dialogs, `ConfirmModal` for confirmations, the `menu.tsx` family for context menus, `showToast()` for transient feedback.
- **Drag previews:** portal `DragOverlay` to `document.body`. Its coordinates are relative to the viewport; blur and transforms on a containing panel would offset or clip it. Keep the overlay mounted, disable its pointer events, and use the z-index ladder.
- **Status:** `Tag` (HUD-style card markers), `Badge` (pills), `Skeleton` (placeholders).
- **3D previews:** `PreviewLoader` (`common/PreviewLoader.tsx`) is the loading state of a 3D preview, and `FanSpinner` the small spinner for a change inside one. A preview shows once all of it is ready, behind the loader until then.

## Page anatomy

Every page renders inside `PageLayout` (`flow` when the shell scrolls, `fill` when the page owns its scroll regions). The shell already scrolls and fades in, so pages never add their own `h-full overflow-y-auto` or `animate-fade-in`.

1. `PageHeader`: serif title, optional one-line description, actions on the right. Anything longer goes in `intro`, which runs under the whole row.
2. Toolbar row: search, one filter popover, view toggle.
3. Content. Full width for grids (Installed, Browse, Locker), `maxWidth="5xl"` for forms and settings.

`EmptyState` for nothing-here, `LoadingState` for pending.

## Don't

- Accent left-border stripes on cards or dialogs.
- An icon in front of every section title.
- Big-number stat tiles.
- A tinted button repeated down every row of a list.
- Em-dashes anywhere (UI strings, comments). Use a colon, period or parens.
- Hardcoded user-facing copy. Visible strings are i18n keys; run `pnpm i18n:manifest` after catalog changes.

## Enforcement

`pnpm ui:check` (in CI) counts raw hex, raw palette colors, `focus:ring`, `white/N` tints and em-dashes per file against `scripts/ui-baseline.json`. A file can lose violations, never gain them. After paying debt down, run `pnpm ui:check --update` and commit the smaller baseline.

After UI changes: `pnpm typecheck && pnpm lint && pnpm ui:check`.
