# Viewer backgrounds

The viewer bundles three promotional map images from Valve's
official City Never Sleeps page: https://www.playdeadlock.com/cityneversleeps .
The images are Valve artwork, not Grimoire artwork or an open-source asset pack.
They are included as backgrounds for the Deadlock preview.

- Broadway: https://cdn.akamai.steamstatic.com/apps/deadlock/images/react/cityneversleeps/broadway_01.jpg
- Uptown: https://cdn.fastly.steamstatic.com/apps/deadlock/images/react/cityneversleeps/uptown_01.jpg
- Times Square: https://cdn.fastly.steamstatic.com/apps/deadlock/images/react/cityneversleeps/times_square_05.jpg

The images are bundled locally so previews and capture work offline. Copyright remains with Valve.

## Preview loader

The loader of a 3D preview (`src/components/common/PreviewLoader.tsx`) shows the news computer from the
game's hideout, with the hideout's mug of cocoa beside it. Its layers in `src/assets/preview-loader/` are
renders of Valve's models `models/hideout/news_computer.vmdl_c` and `models/hideout/hideout_mug_marshmellow.vmdl_c`,
exported from the game's files with `vpkmerge model export`. The fan and the planchette are left out of the
main layer, so the app can turn the pentagram and move the planchette itself. They are Valve artwork too,
bundled so the loader is there before anything has been read from the game. Copyright remains with Valve.

The same computer opens as a hidden toy (`src/components/common/LoaderToy.tsx`), which also has sound: the
clack of its keys (`sounds/ui/ui_keybind_press_01` to `_06`), the hum of its fan (six seconds of
`sounds/ambient/hideout/amb_hideout_watch_projector_fan`, made to loop) and of its tube (four seconds of
`sounds/ambient/hideout/amb_hideout_practice_sign_close_lp`), a tap on its glass
(`sounds/physics/bullet_impacts/glass_bulletproof_01` to `_08`) and the crack of an egg's shell
(`sounds/physics/bullet_impacts/pottery_01` to `_04`), in `src/assets/preview-loader/sounds/`.
These are Valve's sounds, taken from the game's files, and copyright remains with Valve. They play at the
app's own sound volume and only while the toy is open.

`scripts/loader-lab.mts` builds a standalone page that plays the loader on a loop, with controls for its
size, progress, screen programs and layers.
