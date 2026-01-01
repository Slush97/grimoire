# Deadlock Mod Manager - UI Overhaul Brief

**Target Tabs:** Settings, Crosshair Designer, Autoexec Commands

---

## Theme Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `bg-primary` | `#0f0f0f` | App background |
| `bg-secondary` | `#1a1a1a` | Card backgrounds |
| `bg-tertiary` | `#242424` | Inputs/buttons |
| `accent` | `#f97316` | Orange CTA |
| `accent-hover` | `#ea580c` | Hover state |
| `text-primary` | `#ffffff` | Main text |
| `text-secondary` | `#a1a1aa` | Muted text |
| `border` | `#2d2d2d` | Borders |

**Fonts:** Radiance (primary), Reaver (headers), ValvePulp (display)

---

## Settings Tab

**Current Issues:**
- All settings look equally important
- No section grouping
- Status messages are plain text
- Inconsistent button sizes

**Recommendations:**
1. Group into: **Game Path** | **Preferences** | **Maintenance** | **Cache**
2. Make Game Path section most prominent (larger, top position)
3. Use colored badges for status (green ✓, yellow ⚠, red ✗)
4. "Wipe Cache" should have red accent (destructive action)
5. Sync progress: animated progress bar

---

## Crosshair Designer Tab

**Current Issues:**
- Native browser sliders (generic)
- Tiny color picker
- Preview not prominent enough
- All sections look the same

**Recommendations:**
1. Custom sliders with filled track visualization
2. Larger color picker with preset swatches
3. Make preview the focal point (larger, centered)
4. Add subtle glassmorphism to sections
5. Animated checkmark on copy

---

## Autoexec Commands Tab

**Current Issues:**
- No command search/filter
- Categories lack icons
- Descriptions too small
- Plain instructions list

**Recommendations:**
1. Add category icons (⚡ Performance, 🌐 Network, 🎮 HUD)
2. Search bar to filter commands
3. Command cards: hover to show description
4. Toast notifications on save
5. Drag-to-reorder capability (stretch goal)

---

## Profiles Tab

**Current Issues:**
- Profile cards are basic (no visual differentiation)
- No profile preview/comparison
- Mod counts are plain text
- "Active" badge is small

**Recommendations:**
1. Larger visual cards with mod count badges
2. Preview of enabled mods on hover
3. Comparison mode (diff two profiles)
4. More prominent active state (glow effect)
5. Rename profile inline
6. Profile icons/colors for quick identification

---

## General Guidelines

- Use `transition-all duration-200` for hover states
- Section headers: use `font-reaver` for Deadlock game feel
- Icon size: consistent 20-24px from Lucide
- Add subtle micro-animations for polish
- Match existing sidebar/browse tab aesthetic
