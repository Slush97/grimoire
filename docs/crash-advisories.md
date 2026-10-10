# Advisory crash detection

Crash detection adds a clickable `Possible crash cause` badge to the affected
Installed mod and a separate warning icon beside Launch Modded. Findings never
open a dialog automatically. Launching, installing and enabling mods work as
before. Dismissal hides that report and persists across restarts.

The main process reads Windows Deadlock minidump diagnostic comment streams,
Steam process and content logs, gameinfo mounts, and compiled layout/vdata
resources in installed VPKs. Only explicit fatal resource errors qualify.
Warnings near a generic access violation do not select a suspect. Ambiguous
ownership, unreadable resources and unknown search roots produce no badge.
Locker-managed resources can suppress attribution to lower priority user mods.

Grimoire records resource hashes and the observed load order in its own
`crash-advisories.json` file. The diagnostic scanner never creates game folders,
reconciles mod collisions, deletes staging files or changes mod metadata.
There is no telemetry and no background service after Grimoire exits.
Observations and findings are bounded; crash findings expire after 14 days.
The initial run starts a quiet baseline instead of warning about old crashes.

Checks run on startup, every 15 seconds while open, after mod changes, and when
the window receives focus. Steam launches work without Grimoire running, using
the configuration Grimoire last observed. Details disclose that uncertainty.
Launch Modded also queues a configuration observation without waiting for
diagnostic work. Steam repair is handled by inspecting crash reports against
saved history before recording the reset search paths. The existing Fix
Configuration control remains responsible for restoring mounts.

Changing the mod's relevant resources or the game build retires the visible
finding. Disabling the suspect removes the launch marker; the Installed badge
remains available for reference. A clean launch does not prove a previously
suspected resource is fixed, so it does not automatically dismiss a finding.

## Manual test

Generate the intentionally broken HUD outside the game:

```powershell
node --experimental-strip-types scripts/create-crash-advisory-fixture.mjs --game 'C:\Steam\steamapps\common\Deadlock' --out 'C:\Temp\crash-test'
```

The fixture contains one compiled `panorama/layout/hud.vxml_c` with an unknown
panel type. It is intended to produce a fatal layout error when Deadlock loads
the HUD. Generation validates the compiled resource; an actual game crash must
still be verified manually against the current game build.

1. Start the test build once to establish its baseline. Import
   `DO_NOT_PLAY_HUD_CRASH_TEST_dir.vpk` using the normal local import flow.
2. Make the fixture the first HUD provider in load order. Wait at least 15
   seconds for the configuration observation. Close Grimoire.
3. Launch Deadlock through Steam. Let the intentional crash and Steam's file
   verification finish, then reopen the test build.
4. Expect an Installed badge and a launch warning icon. Clicking the icon shows
   the fatal error and suspected mod. Show mod opens the Installed page and
   filters to the suspect, including local mods. Launch Modded remains available.
5. Disable the fixture using its usual toggle. The launch marker disappears.
   Dismiss the report and restart Grimoire to check dismissal persists.
6. Repeat with Grimoire kept open. A new finding should appear within about 15
   seconds after the crash dump finishes writing.
7. Delete or disable the fixture before using Fix Configuration or playing
   normally. Fix Configuration restores mounts; it does not remove the fixture.

If another VPK or loose HUD takes precedence, the fixture will not supply the
loaded HUD and this test cannot establish attribution to it. Generic crashes
without a fatal resource path intentionally produce no mod accusation.
