# Grimoire gameinfo.gi diagnostic

Hand this to a Windows user when Grimoire reports `gameinfo.gi not found`
and Steam's Verify integrity of game files isn't resolving it.

## What it does

Read-only. Modifies nothing. Collects, in one report:

- Steam install path (registry) and library list (`libraryfolders.vdf`)
- Which library `appmanifest_1422450.acf` lives in
- Whether `<deadlock>\game\citadel\gameinfo.gi` actually exists on disk
- Per-directory case-sensitivity flag (`fsutil`)
- Every file in `citadel\` whose name starts with `gameinfo` (catches
  `gameinfo.gi.bak`, `GameInfo.gi`, etc.)
- ACLs on `citadel\` and `gameinfo.gi`
- Windows Defender protection history entries that mention gameinfo /
  citadel / Deadlock (best-effort; some entries need admin to read)
- Grimoire's saved `deadlockPath` from `%APPDATA%\Grimoire\settings.json`

The report is written to the Desktop as
`grimoire-gameinfo-diagnostic.txt` and opened in Notepad.

## How to ask the user to run it

1. Download both files (`Run-Diagnostic.cmd` + `diagnose-gameinfo.ps1`) to
   the same folder, e.g. their Downloads folder.
2. Double-click `Run-Diagnostic.cmd`.
3. Notepad opens with the report. Send it back.
