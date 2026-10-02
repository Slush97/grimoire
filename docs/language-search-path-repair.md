# Missing localized hero-name artwork

Grimoire 1.29.0 and earlier replaced the entire `SearchPaths` block when enabling
mod support or repairing configuration. This removed Valve's language and
low-violence entries. Disabling mods does not restore those entries, which
explains why the Korean hero-name artwork can stay missing with all mods off.

The current stock entry is `Game_UILanguage citadel_*LANGUAGE*`. Valve changed
the older `Game_Language` key on September 29, 2026 so localized images follow
the UI language rather than the audio language. Source:
[tracked stock gameinfo.gi](https://github.com/SteamDatabase/GameTracking-Deadlock/blob/58b3529cc17088df1eed5c39c6eeac72d7133b16/game/citadel/gameinfo.gi#L59-L70).

## Message to send the reporter

We found a bug in Grimoire's game configuration handling that removes the entry
used to load localized hero-name artwork. You do not need to delete your mods
or reinstall Deadlock. Please try this temporary repair:

1. Close Deadlock and Grimoire.
2. In Steam, right-click Deadlock, then choose **Manage > Browse local files**.
3. Open `game`, then `citadel`. Make a backup copy of `gameinfo.gi`.
4. Open `gameinfo.gi` in Notepad. Find the `SearchPaths` section.
5. Inside its braces, add this single line after the mod paths
   (`citadel/grimoire`, `citadel/addons`, and any `citadel/addons1` etc.), but
   before the `Mod citadel`, `Write citadel`, or `Game citadel` entries:

   ```text
   Game_UILanguage    citadel_*LANGUAGE*
   ```

   Leave `*LANGUAGE*` exactly as written. Do not replace it with `koreana`.
   If this exact active entry is already present, do not add it again.
6. Save the file as `gameinfo.gi`, not `gameinfo.gi.txt`, and launch Deadlock
   with Korean selected. Please confirm whether the stylized names return.

Until a Grimoire release includes the fix, avoid **Fix Configuration** after this
manual repair. If Grimoire rewrites the search paths again, the entry may need
to be re-added. To undo the manual edit, restore your backup with the game closed.

## Code fix

- Preserve existing Valve and third-party entries when adding managed mod paths.
- Restore missing `Game_UILanguage` and `Game_LowViolence` entries before base
  game content. Preserve legacy `Game_Language` and future language mounts too.
- Flag old configurations as needing repair, even when both Grimoire paths are
  already present. The existing Fix Configuration flow and mod-enable repair
  call sites then restore the missing mounts.
- Keep override, base-addon, overflow and Deadworks priority, the one-time
  backup, and the file's line endings. Leave all other gameinfo sections intact.

The configuration regression is covered by automated tests. Visual restoration
of the reporter's Korean hero-name artwork still needs their in-game check.
