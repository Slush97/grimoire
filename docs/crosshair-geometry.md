# Crosshair geometry: how Deadlock actually draws it

Reference for `src/components/crosshair/drawCrosshair.ts` and
`src/lib/crosshair.ts`. Read this before touching the preview renderer.

Everything below was recovered from the shipped game, not guessed:

- `game/citadel/pak01_dir.vpk` -> `panorama/styles/ability_hud_elements/element_gun.vcss_c`
  (the crosshair's stylesheet)
- `game/citadel/bin/win64/client.dll` -> the gun HUD element's constructor and
  per-frame style update (the C++ that owns the geometry)

VPK entries were listed and extracted with `vpkmerge-core`'s dev examples
(`find_entry`, `extract_entry`, `decodetex`). Re-run those after a game patch to
confirm nothing moved.

## Where the crosshair lives

It is **not** a texture and **not** a standalone panel. It is part of the *gun
ability HUD element*, built in C++ out of plain Panorama panels found by name:

```
GunGrosshair            container (typo is Valve's)
  TopArc     BottomArc     LeftArc     RightArc
  TopPip     BottomPip     LeftPip     RightPip          <- the four lines
  TopPipOutline  ... x4                                  <- their outlines
  TopPipBlack    ... x4                                  <- hidden by default
  Dot
  DotOutline
```

Base styling comes from `.crosshair__pip`, `.crosshair__pipborder`,
`.crosshair__dot`, `.crosshair__dotborder` in `element_gun.vcss`. Each frame the
C++ overwrites size, opacity, colour and `border-width` from the
`citadel_crosshair_*` convars. Pips are solid `background-color`, no image and no
`border-radius`, so they are sharp rectangles. The dot and dot outline carry
`border-radius: 50%`, so they are circles.

The per hero reticles at the bottom of that stylesheet (`.viper .crosshair__pip`
and friends) swap in `background-image` textures and hard-code sizes. They ignore
the convars entirely, which is what
`citadel_crosshair_disable_hero_specific_crosshairs` turns off.

## Positioning

The four pips are positioned by one helper that walks a 4-panel array applying a
rotation of `index * 90deg` plus a per-group offset angle (0 for pips, 45 for
arcs) and a translation of `D` along the rotated axis. So:

- each pip's **centre** sits `D` from screen centre
- the panel itself is rotated, so the left/right pair is the top/bottom pair with
  width and height swapped

```
D = cppArcDefaultOffset + citadel_crosshair_pip_gap
  = 4 + pip_gap
```

`cppArcDefaultOffset: 4.0` is an `@define` in `element_gun.vcss`, read once at
construction. (`cppPipDefaultOffset: 7` is defined in the same file but the
shipped code path never reads it. Do not "fix" this by using 7.)

When `citadel_crosshair_pip_gap_static` is `false` (the game's default) live
weapon spread is added to `D` every frame. A static editor cannot show that, so
Grimoire models the static shape only.

## Integer truncation

This is the single easiest thing to get wrong. `pip_width`, `pip_height` and
`dot_size` are **float** convars, and the in-game sliders persist raw floats into
`machine_convars.vcfg` (`citadel_crosshair_dot_size "8.301266"` is a real value).
But the HUD runs every one of them through `cvttss2si` (truncate toward zero)
before applying it:

| convar | type | truncated before use |
|---|---|---|
| `pip_width` | float | yes |
| `pip_height` | float | yes |
| `dot_size` | float | yes |
| `pip_outline_gap` | int | yes |
| `dot_outline_gap` | int | yes |
| `pip_outline_border` | int | read as int |
| `dot_outline_border` | int | read as int |
| `pip_gap` | int | read as int |
| all four `*_opacity` | float | no, used as-is |

So `dot_size 8.301266` renders as an 8px dot. Half-step sliders in the editor
are a lie: the preview and the game both round them down.

## Outlines and the Panorama box model

The outline panels are sized to the **outer** box and their border is painted
**inward**:

```
pipOutlineWidth  = pip_width  + pip_outline_gap + 2 * pip_outline_border
pipOutlineHeight = pip_height + pip_outline_gap + 2 * pip_outline_border
dotOutlineSize   = dot_size   + dot_outline_gap + 2 * dot_outline_border
border-width     = *_outline_border
```

Because the border eats into that box, the hole left in the middle is
`pip_dim + gap`, and the pip is centred in it. **Clearance between the pip edge
and the outline is `gap / 2` per side, not a full `gap`.**

Evidence for borders being drawn inward rather than outward: the concentric ammo
rings in the same stylesheet only line up under that reading. `#clip_bg_progress_bar`
(98px / 8px border), `#clip_progress_bar` (94px / 4px) and `#clip_bullet`
(96px / 6px) all land on a border centreline diameter of exactly 90 when the
border is inside the box, and on nothing in common otherwise.

## Rasterization: whole device pixels, composed in layout units

The game rasterizes the crosshair on **whole device pixels**. Measured from a
1440p screenshot with `pip_width 1`, a pip is exactly one pixel of
`rgb(5,254,254)` with untouched background on both sides. A canvas drawing the
same pip at its true fractional width (1 x 4/3 = 1.333px) antialiases it into
two pixels at about 78% coverage each, which reads as a line twice as thick,
blurry, and visibly dimmer (`rgb(9,200,199)`). That was the single largest
remaining mismatch after the geometry above was fixed.

Two rules matter, and they interact:

1. **Compose in layout units, snap once.** The C++ builds each panel's size in
   1080p layout px (`SetWidth(gap + pip_width + 2 * border)`) and Panorama
   converts to device px afterwards. So a 3px outline box at 1440p is
   `round(3 * 4/3) = 4` device px. Snapping the parts first and adding them
   would give `1 + 2 = 3`, one pixel narrower, and it is wrong.
2. **The centre is not snapped.** The stylesheet uses
   `horizontal-align: center_nopixelsnap` / `vertical-align: center_nopixelsnap`,
   so a box with an odd device size straddles the centre and its leading edge
   rounds half-up. This is why an odd-height outline box is not symmetric about
   the centre: at 1440p the top cap lands 12px above centre and the bottom cap
   12px below, from an 11px-tall box. `Math.round` on the leading edge
   reproduces it.

Verified against the same screenshot: the bottom pip and its outline match the
renderer pixel for pixel across rows +6 to +12 (outline flanks, 1px pip, the pip
ending one row before the outline, and the 4px end cap).

## Opacity and colour

Opacity is a panel property, applied by the C++ via `SetOpacity`, not baked into
the colour:

- pip panel opacity = `pip_opacity`, background colour = `color_r/g/b`
- pip outline panel opacity = `pip_outline_opacity`, border colour = `outline_color_r/g/b`
- dot / dot outline the same with their own convars

Multiplying the colour's alpha instead is equivalent for a flat draw, which is
what the canvas renderer does.

## Convar defaults

These are the defaults `client.dll` registers, i.e. what a fresh install looks
like. They are **not** the same as `CROSSHAIR_DEFAULTS` in `src/lib/crosshair.ts`,
which is Grimoire's editor starting point. Both are exported so the difference
stays deliberate; see `CROSSHAIR_GAME_DEFAULTS`.

| convar | game default | Grimoire default |
|---|---|---|
| `pip_gap` | 4 | 5 |
| `pip_gap_static` | false | true |
| `pip_width` | 2.0 | 2 |
| `pip_height` | 16.0 | 10 |
| `pip_opacity` | 0.5 | 1 |
| `pip_outline_border` | 1 | 1 |
| `pip_outline_gap` | 1 | 0 |
| `pip_outline_opacity` | 0.7 | 1 |
| `dot_size` | 4.0 | 8 |
| `dot_opacity` | 0.7 | 0 |
| `dot_outline_border` | 2 | 2 |
| `dot_outline_gap` | 2 | 0 |
| `dot_outline_opacity` | 0.7 | 0 |
| `color_r/g/b` | 255/255/255 | 0/255/0 |
| `outline_color_r/g/b` | 0/0/0 | 0/0/0 |

## Convars Grimoire does not model

`citadel_crosshair_clip_angle` (90), `citadel_crosshair_clip_bullet_gap` (0.5) and
`citadel_crosshair_clip_offset_angle` (180) drive the ammo ring around the
crosshair, not its shape. `citadel_crosshair_hit_marker_duration` (0.1) and
`citadel_crosshair_out_of_range_dist` are behavioural. None belong in the preset
format.

## What is still assumed

The scale factor. Grimoire draws in 1080p reference pixels and multiplies by
`display height / 1080`, matching Panorama's ui-scale convention. That has not
been re-derived from the binary, but a 1440p screenshot measured against it fits
to the pixel, so it is now corroborated rather than merely assumed.

Antialiasing of the round parts. The dot and dot outline are drawn as canvas
arcs, which feather their rim the way Panorama feathers a `border-radius: 50%`
panel. The exact filter is not the same, so a 3px dot may differ by a shade at
the edge. The straight parts, which are what you actually aim with, are exact.
