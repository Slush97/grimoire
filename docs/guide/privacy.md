# GameBanana requirements

Opening Installed may request the structured requirements for its GameBanana mods. These requests use the same GameBanana rate limiter as browsing. Successful results are cached locally for 24 hours in `mod-requirements.json`.

Opening a mod's details fetches its requirements with the existing details request. If GameBanana returns an unrecognized requirement code, Grimoire requests that mod's ProfilePage to read its labels. Opening a required mod fetches its details when clicked.

Requests contain GameBanana submission IDs and section names. Local file paths, mod files, profiles, and enabled states stay on the device. Grimoire compares requirements against the local library on the device.

This feature adds no analytics or telemetry. WiPs do not expose structured requirements and are excluded from requirement requests.
