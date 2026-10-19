# Locker artwork

The default Locker portraits use Valve's illustrated hero artwork, with the
decorative background and transparent edges intact. They are bundled with the
app and are not fetched at runtime. User-selected mod images still take priority.

`scripts/locker-artwork.json` records the selected source, dimensions and SHA-256
for every unique hero in the shared roster. The Deadlock Wiki hosts the source
PNGs. Doorman and The Doorman share one illustration.

The wiki's latest `Render` upload is not always the illustration we want. Yamato
uses the archived illustrated version rather than the newer model render. The
manifest pins image contents so refreshing assets cannot silently change styles.

Run `node scripts/fetch-locker-art.mjs --check` to verify the entire roster offline.
Run `node scripts/fetch-locker-art.mjs` to restore any missing or changed files
from the selected sources. Updating a source requires visually reviewing its
Locker card, full backdrop and sidebar crop, then recording its new hash.

The October 2026 audit covers all 44 unique heroes. It includes the exact Solomon,
Deadman Danny, Nurse Harrow, Rat King, Baba and Violet illustrations supplied in
the feature request.
