# UI conventions

The house rules for building UI in the Grimoire renderer. The goal is uniformity by default: reach for an existing primitive before writing markup, and use tokens instead of raw values. New code that follows these keeps the design system honest; new code that doesn't is the "slop" we're paying down.

Primitives live in `src/components/common/` (`ui.tsx`, `forms.tsx`, `PageComponents.tsx`, `Modal.tsx`, `menu.tsx`, `ToastStack.tsx`, `Skeleton.tsx`). Design tokens live in `src/index.css` under `@theme`.

## Tokens, not raw values

Every renderer surface belongs to one of these three contracts:

- **App surfaces:** use `bg-bg-*`, `text-text-*`, and `border-border` (or `hl` for a surface-relative highlight). These resolve with light, dark, and system themes.
- **Statuses:** use `state-success`, `state-warning`, `state-danger`, or `state-info` for text, icons, fills, borders, and rings. Pair status color with an icon and/or explicit label so meaning never depends on hue alone.
- **Media overlays:** use the invariant `overlay-*` palette on `bg-overlay-bg`, or use `Tag variant="overlay"`. Overlay foregrounds stay bright because the coupled surface stays dark in both app themes.

`pnpm theme:check` enforces these boundaries in renderer source. It rejects raw status-palette text, literal `text-white`, undefined custom theme utilities, and color overrides on overlay tags. CI runs the same command.

- **No raw hex** in `className`/`style`. Use a token utility (`bg-bg-secondary`, `text-text-primary`, `border-border`, `bg-accent`). If a value is genuinely new and reusable, add a token to `@theme` first.
- **No raw Tailwind palette colors** (`green-500`, `red-400`, `zinc-300`, ...) where a semantic token exists. Status/state -> `state-success | state-warning | state-danger | state-info`. Brand -> `brand-discord | brand-kofi`.
- Prefer `text-text-primary` over `text-white`. The accent foreground flips by luminance at runtime; literal whites can't.
- Surfaces: app bg `bg-bg-primary`, cards/panels `bg-bg-secondary`, inputs/raised `bg-bg-tertiary`.
- Use `hl` for surface-relative highlights: dividers, subtle borders, raised tints, and hover fills. It adapts across light and dark themes; `white/*` does not.
- Use `accent-ink` for accent-colored text and icons on neutral surfaces. Reserve `accent` for fills, borders, focus rings, and other large or decorative marks where the selected accent remains legible.
- Do not use literal `text-white`, including on media. Use `text-overlay-primary`/`secondary`/`muted` and keep it coupled to `bg-overlay-bg` or a media scrim. Brand and saturated status fills use their named foreground token.

## Components, not ad-hoc markup

- **Buttons:** use `Button` (text + variants: primary/secondary/danger/success/warning/ghost; sizes sm/md/lg; `icon`, `isLoading`) or `IconButton` (icon-only, requires a `label`). Do not hand-roll `<button className="px-3 py-1.5 ...">`.
- **Form controls:** use `Input`, `Textarea`, `Select`, and `FormField` from `forms.tsx`. Never style a raw `<input>`/`<textarea>`/`<select>` inline. Domain pickers (`HeroSelect`, `DynamicSelect`) are the exceptions and stay as-is.
- **Page structure:** every page renders inside `PageLayout`. Title rows use `PageHeader`; "nothing here" states use `EmptyState`; loading uses `LoadingState`; top action bars use `PageToolbar`; view switching uses `ViewModeToggle`/`SegmentedControl`.
- **Overlays:** dialogs use `Modal` (+ `ModalHeader`); confirmations use `ConfirmModal`; context menus use the `Menu` family; transient feedback uses the toast store. Pick z-index from the ladder documented at the top of `index.css` (never invent `z-[9999]`).
- **Status chrome:** `Tag` (HUD-style card markers) and `Badge` (pills). `Skeleton` for placeholders.

## Visual scale

- **Radius:** `rounded-sm` is the default (cards, tags, inputs, buttons). `rounded-full` only for pills/avatars. Avoid mixing `rounded-md`/`rounded-lg`/`rounded-xl` for the same role.
- **Focus:** `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`. Use `focus-visible`, not `focus` (the latter fires on click). Add `ring-offset-2 ring-offset-bg-secondary` on solid surfaces.
- **Form-control surface (canonical):** `bg-bg-tertiary border border-white/5 rounded-sm` + the focus ring above + `disabled:opacity-60 disabled:cursor-not-allowed`. This is baked into the `forms.tsx` primitives; match it if you must go custom.

## Other hard rules

- **No em-dashes** anywhere (UI strings, comments). Use colon/period/parens.
- **Visible strings are i18n keys.** Add real keys to `src/locales/en/translation.json` and run `pnpm i18n:manifest`. Never hardcode user-facing copy.
- After UI changes: `pnpm typecheck` + `pnpm lint`.
