# Retained mod backups

Settings > Preferences > Keep removed mod files for 24 hours is off by default.
When enabled, Grimoire saves the old VPK, split archive chunks, and metadata before
an installed mod is deleted or replaced, including updates and merge rebuilds.
These are real file backups, separate from the portable-profile JSON snapshots.

Files are stored under the Electron user-data directory in `mod-backups`, normally
`%APPDATA%\grimoire\mod-backups` on Windows. Backups older than 24 hours are removed
only when Grimoire starts. They remain available during the current session, even
after reaching that age. Turning capture off leaves existing backups available
until restoration, a later startup cleanup, or manual deletion.

The installed mod's context menu shows Backups only when matching backups exist.
If its last file is deleted, the backups become accessible when the mod is installed again.
The menu lists old filenames with descriptions on hover. Restoring copies the
saved VPK set to a new disabled install and preserves its metadata without
overwriting current mods. It keeps the original VPK filename unless that name is
already installed. On a collision, five random letters and numbers are appended
to the stem, preserving the `_dir.vpk` suffix and matching split-chunk names.
The saved backup is removed after a successful restore.
The red trash control uses the standard mod-delete prompt before permanently
deleting a backup. Keyboard users can press
Delete on a focused backup entry for the same confirmation.

Capture and restore failures leave the original files or backups in place.
The storage queue serializes capture, cleanup, deletion, and copying; restores
also run under the normal mod mutation lock. Backups have opaque IDs, validated
manifests, and payload hashes. This feature makes no network requests.
If the active mod folder or developer mode changes while a restore is waiting,
the restore stops and keeps its backup available to retry.

Developer mode uses `mod-metadata.dev.json` and `mod-metadata.dev.backups`, separate
from normal mode's `mod-metadata.json` and `mod-metadata.backups`. Each mode creates
and maintains its own metadata. Mode switches wait for mod writes and are refused
while downloads or update work remain. Settings save only the requested changes,
so a delayed mode switch preserves preferences saved while it waits.
Under the developer folder path, **Copy mods to
dev mode** explicitly replaces the developer library and metadata with copies
of the normal library. This includes disabled mods, overflow and Global folders,
split archive chunks, Locker artifacts, and custom card sources. Normal files,
metadata, settings, and backups stay untouched. A failed copy restores the previous
developer library. Old developer metadata snapshots and leftover temporary metadata
are removed with the previous library. A confirmation warns about disk space,
copying time, and deleting and replacing all current developer mods and metadata.
The `replays` folders at mod roots are excluded, including replay junctions created
by Grimoire. Recordings are not mod files and stay in their original locations.
The button shows a percentage and a progress bar based on bytes copied, reaching
100% after the copy is committed.
Progress and the busy button persist when navigating away from Settings and back.
The main process also refuses duplicate copies while one is queued or running.
