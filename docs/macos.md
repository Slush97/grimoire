# macOS support

Grimoire runs on macOS for development and local mod testing. This document
covers what is different about the platform and why, because almost none of it
is obvious from the code alone.

## Why macOS is not just "another desktop"

Deadlock ships **no macOS depot**. The native Steam client at
`~/Library/Application Support/Steam` can never install it, no matter what the
user does. The only way the game exists on a Mac is inside a Wine prefix (in
practice a CrossOver bottle) where a *Windows* Steam installed the *Windows*
depot.

Every platform assumption that holds on Windows and Linux breaks here:

| Assumption | Reality on macOS |
| --- | --- |
| Steam lives at a known per-platform path | Steam lives inside a user-named bottle |
| `libraryfolders.vdf` holds host paths | It holds Windows paths (`C:\...`) |
| `steam://` URLs reach the right Steam | They reach the native client, which lacks the game |
| The game is a host process | It is a Windows process under Wine |

## Prerequisites

1. **CrossOver** at `/Applications/CrossOver.app` or `~/Applications/CrossOver.app`.
   Set `GRIMOIRE_WINE` to a Wine binary to override the search.
2. **A bottle containing Windows Steam**, with Deadlock installed into it.
3. **Rosetta 2**, since CrossOver's `wineloader` is x86_64 only.

### Bottle graphics backend

A bottle created with `cxbottle --create` gets **no graphics backend** and falls
back to wined3d over OpenGL, which macOS caps at GL 4.1. Source 2 does not
survive that. Append to `[EnvironmentVariables]` in the bottle's
`cxbottle.conf`, then restart the bottle's wineserver:

```
"CX_GRAPHICS_BACKEND" = "d3dmetal"
"WINEMSYNC" = "1"
```

Bottles created through the CrossOver GUI's application database get this
automatically. Valid values are `d3dmetal` and `dxvk`.

## How detection works

`electron/main/services/steamRoots.ts` is the single source of truth for "where
is Steam". It replaced three separate hardcoded per-platform path lists (game
detection, `loginusers.vdf`, `localconfig.vdf`), all of which were wrong on
macOS in the same way.

On darwin it enumerates `~/Library/Application Support/CrossOver/Bottles/*`,
treats any bottle containing `drive_c/Program Files (x86)/Steam` (or the
non-x86 variant) as a Steam root, and puts those ahead of the native location.

Windows paths read out of a bottle's VDF files are mapped back to host paths
through that bottle's `dosdevices/` symlinks. This matters for users with more
than one Steam library: a `D:\SteamLibrary` entry is meaningless to the host
until it is resolved through `dosdevices/d:`. Note that `z:` conventionally maps
to `/`, so a Windows path can legitimately point back out at native files. A
library on an unmapped drive letter is dropped rather than guessed at.

## How launching works

`electron/main/services/bottleLaunch.ts` drives the bottle's own `steam.exe`:

```
<CrossOver>/bin/wine --bottle <name> -- <bottle>/steam.exe -applaunch 1422450
```

`triggerSteamLaunch` in `launch.ts` picks this path only when the configured
Deadlock install actually resolves to a bottle, so a hypothetical future native
macOS install would still take the normal `steam://` route.

Process control (`isDeadlockRunning`, `requestDeadlockStop`) shares the Linux
branch: the game is a Windows process under a translation layer, so the host
only ever sees it via the full cmdline, and `pgrep -f` / `pkill -f` are correct.

## What is not supported

- **No packaged macOS build.** `electron-builder.yml` has no `mac` target and
  there is no `package:mac` script. Adding one requires decisions about signing
  and notarization, and the auto-updater expects a signed build.
- **CI does not cover macOS.** `ci.yml` runs `ubuntu-latest` only. The bottle
  discovery, drive mapping, and launch-argument tests are all
  platform-independent and do run there.
