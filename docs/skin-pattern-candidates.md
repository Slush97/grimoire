# Pattern candidates

Research and generator review, 2026-10-26. Moo is implemented in the generator and editor catalog. The other entries remain design proposals. The first in-game Moo probes confirmed palette application and scrolling but exposed oversized, soft patches on fragmented UV layouts. The revised generator uses denser, sharper organic spots and a Moo-only Scale control. Native previews and palette/seam/export tests pass; the revised print still needs an in-game visual check.

Start with **Moo**, **Shard Luck**, **Hazard Pay**, **Snake Oil** and **Porcelain Damage**. They add recognizable motifs to a picker that already has plenty of noise, gradients and psychedelic effects.

## What the game examples suggest

Fortnite applies the same wrap across weapons, vehicles and selected outfit pieces, while allowing separate accent colors. The useful lesson for Door Stuck is to make a pattern work both as a loud whole-body joke and as one restrained accent part. The supplied Fryangles picture suggests angular shapes and a strong dark/light palette; these proposals do not reproduce that wrap. [Epic's Show Your Style announcement](https://www.fortnite.com/news/fortnites-show-your-style-set-introducing-wrappables%3Flang%3Den-US)

Valve's Hydrographic finish uses a pattern and four colors, with some regions left as solid colors. This supports a simple design approach: two to four clear color roles, readable shapes, and the existing per-part editor to leave grips, faces or hardware alone. Valve's material packing is specific to Counter-Strike and should not be copied into Deadlock. [Valve's Hydrographic guide](https://www.counter-strike.net/workshop/wf_hydrographic)

Riot's Radiant Crisis collection takes a comic-book visual theme across a weapon family. Our Halftone already covers dots, so a fresh addition should use a different motif such as line doodles, rather than adding another generic Comic button. [Riot's collection announcement](https://playvalorant.com/en-us/news/announcements/what-s-new-in-valorant-episode-3-act-iii/?linkId=100000080700998)

Psyonix describes Skulking Scale as an animated decal combining crystal and dragon scales. A repeating scale motif is a useful direction, but the proposed Snake Oil below uses our own geometry, palette and timing. [Rocket League Season 9](https://www.rocketleague.com/news/unleash-the-elements-in-season-9)

Epic distinguishes cosmetics that react to in-game events. That is a separate feature from moving a texture over time. None of the proposals below promises kill, damage, music or firing reactivity. [Epic's reactive cosmetics explanation](https://www.epicgames.com/help/c-34254770/c-33726977/fortnite-reactive-cosmetics-a16117760)

## Candidate set

Palettes are suggestions for the generated albedo. They are color values, not promises of glow, metal, raised scales or real cracks. Every candidate can use the existing custom palette option.

| Name | Look and default palette | Motion with the current skin pipeline | Implementation |
|---|---|---|---|
| **Moo** | Large, irregular black cow patches on warm milk white. Rounded lobes and generous clean space, not tiny speckle. `#202027`, `#E7E1D5`. Optional strawberry-milk custom palette is an obvious extra joke. | The spots can scroll as one tile. Visually strongest stationary, with speed 0 available. If keeping the editor-wide 50% default, do not give the spots extra phase-based deformation. | Low to medium. Threshold a seamless, domain-warped low-frequency noise field; smooth only the patch edges. Keep patch coverage around one third to one half of the tile so it reads as cow hide rather than Camo. |
| **Shard Luck** | Asymmetric, sharp triangular plates with narrow dark gaps and a few small contrasting shards. Coal, burnt orange, pale amber: `#25242A`, `#B64925`, `#E6C87B`. | UV scrolling makes the shards move past each other visually, although they remain one rigid tile. No exploding, rotating or independently moving pieces. | Medium. Periodic triangular tessellation with stable cell colors, inset borders and a deliberately uneven distribution of triangle sizes. This is angular fragmentation, not another Lava recolor. |
| **Hazard Pay** | Chunky diagonal industrial tape with occasional broken sections and small double-chevron accents. Ink and warning yellow: `#28282A`, `#DDBA45`; optional orange `#CB6334`. | Scrolling reads like a conveyor belt. Good moving candidate at the existing 50% speed default. | Low. Analytic diagonal bands plus periodic interruptions. Keep the main stripe broad enough to survive minification. |
| **Snake Oil** | Overlapping rounded diamond scales, each with a dark seam and a small bright edge. Petrol green, navy and mint: `#173A36`, `#252B3B`, `#88B99E`. | UV scrolling produces a sliding scale coat. It cannot change the silhouette or make individual scales lift. | Low to medium. Staggered analytic scale cells with a restrained painted edge highlight. Surface roughness remains a separate choice. |
| **Porcelain Damage** | Pale ceramic islands with dark cobalt detail and thin gold repair seams. `#DEDCD0`, `#304A75`, `#B89A50`. More broken teacup than hot magma. | Can scroll, but looks more like a physical object at speed 0. Gold seams are painted unless the material system later supports a separate metalness mask. | Medium. Periodic fractured-cell distance field, narrow seam mask and sparse blue decorative arcs. Use broad ceramic islands so it stays distinct from Lava. |
| **Check Yourself** | Slightly bent checkerboard with an occasional missing or inverted square. Cream, charcoal and a sparse cherry accent: `#DFD7C4`, `#29262E`, `#A73B48`. | UV scroll gives a rolling checkerboard. Any warping is baked into the tile; it does not wobble over time. | Low. A periodic checker mask with a small seamless coordinate warp. Broad squares avoid Moire's fine interference texture. |
| **Bubble Trouble** | Large overlapping bubble rings, a few solid circles and tiny painted crescent highlights. Deep purple, lavender and peach: `#302440`, `#A78BC7`, `#DFAE98`. | Slow UV scrolling looks like bubbles floating past. They do not expand, pop or become transparent. | Low to medium. Periodic circle placement with a small number of radius classes and ring thicknesses. No extra transparency feature is required. |
| **After Hours** | Art-deco fan arches and stepped borders, fitting Deadlock's setting. Midnight blue, muted brass and ivory: `#202E41`, `#B1975D`, `#DCD3BC`. | Optional sliding wallpaper effect. Stationary is the stronger default look. | Low to medium. Repeated radial fan bands and stepped chevrons with a thick outline. Avoid very fine ornament that disappears on small guns. |
| **Doodle Duty** | Loose, hand-drawn stars, eyes, spirals and crooked lightning bolts on mostly empty paper. Cream, dusty red and ink: `#DFD8C5`, `#B4555A`, `#343342`. | The motif sheet can drift. Drawings do not animate independently and no comic speech bubbles appear on hits. | Medium. A small original vector motif library, placed with periodic jitter and rotation. Keep the shapes simple enough for a 64px picker swatch. |
| **Short Circuit** | Right-angle circuit paths with a few large pads and deliberately dead ends. Dark teal, copper and cyan: `#1D343B`, `#B77B54`, `#78C4C1`. | UV scroll moves the entire diagram. Light travelling along fixed traces would need an additional animated mask or supported material expression. | Medium. Periodic grid routing with a limited number of path widths and round/square pads. No actual emissive or reactive behavior implied. |

## First batch

1. **Moo** is required and the clearest comic option. Test large spots on a coat, small spots on a weapon, and a pink/cream custom palette.
2. **Shard Luck** responds to the supplied inspiration through geometry and palette, while leaving the artwork original.
3. **Hazard Pay** is cheap, readable and immediately benefits from the animation already supported.
4. **Snake Oil** adds a structured organic motif that Camo and Liquid do not cover.
5. **Porcelain Damage** gives a quieter decorative choice that should pair well with glossy surfaces.

The next three picks would be After Hours, Check Yourself and Doodle Duty. Bubble Trouble and Short Circuit are useful later, especially if we add more motion options.

## Current capabilities and limits

The previous 14 styles are Confetti, Liquid, Moire, Kaleido, Holo, Glitch, Thermal, Gradient, Camo, Carbon Fiber, Galaxy, Halftone, Lava and Vaporwave. Moo adds a fifteenth. Avoid spending this batch on another rainbow gradient, generic marble, starfield, pixel glitch or dot pattern.

The helper generates a seamless albedo tile and writes runtime UV scroll vectors. The skin-part viewer uses that tile and changes its texture offset over time. This can support all ten proposed motifs without introducing a new game shader. Adding each style still requires generator, parser, app enum, label, palette and preview/export tests.

The sprite-swatch API can generate frames by advancing the pattern phase. That alone does not mean the exported skin morphs through those frames. The part viewer and in-game export must agree on UV scrolling; do not advertise expanding bubbles, pulsing cells, independently tumbling shards or moving light along stationary circuits until there is a verified export mechanism for them.

Keep the current custom-colors-off setting and 50% new-pattern speed behavior unless the user chooses a different policy. The table notes where speed 0 gives the most natural result. A later Scale control would be useful because a repeat that reads well on a coat may be too large or stretched on a gun. Authored UV islands still determine distortion and seam placement.

For acceptance, inspect at least one body, one weapon and one supported transform in the same game launch. Check the tile seam, small-mip readability, custom palettes, intensity blending, speed 0 and 50%, and slider replacement stability. New pattern screenshots are still required; the existing gradient tests do not validate these new generators.

Local source reviewed: `src/lib/trippy.ts`, `src/types/mod.ts`, `src/components/locker/SkinPartPatterns.tsx`, and `../vpkmerge-skin-feedback/vpkmerge-core/src/trippy.rs`. No app, game or profile state was changed for this research.
