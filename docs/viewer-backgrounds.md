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
game's hideout. Its layers in `src/assets/preview-loader/` are renders of Valve's model
`models/hideout/news_computer.vmdl_c`, exported from the game's files with `vpkmerge model export` and drawn
without its fan, so the app can turn the pentagram itself. They are Valve artwork too, bundled so the loader
is there before anything has been read from the game. Copyright remains with Valve.
