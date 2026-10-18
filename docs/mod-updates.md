# Queued mod updates

Update checks are owned by `modUpdateCheckStore.ts`, mounted once by the app.
Checks continue across tabs and publish shared flags for Installed to read.
The shell loads the installed library even when starting on another tab.
Library changes, matching preferences, and file-list invalidation trigger checks;
window focus retries failed or expired requests through `updateCheckCache.ts`.
File lists stay cached for 30 minutes, with at most five requests in flight.
Passes are serialized so changes during a check cannot multiply the request cap
or publish obsolete flags. Merged sources and ignored variants retain their
existing matching rules. There is no periodic polling.

Bulk updates are owned by `modUpdateController.ts` in the main process, with
runtime dependencies in `modUpdates.ts`. State stays in memory and survives
renderer navigation. The Installed toolbar shows `Update (n)` for mods that have
not started updating. Selected, preparing, queued, active, and manual-pending
files leave the menu immediately. Further selections append to the same FIFO
session, sharing its recovery snapshot. The toolbar button disappears when no
eligible updates remain.
Clicks commit their optimistic removal immediately, and an empty menu renders
no dialog while its close callback settles.

The update menu groups pending variants by GameBanana submission and section.
The toolbar's `Update (n)` counts these mods; the menu title `Update n files?`
counts their pending files. Its footer action is `Update all`.
Each mod shows its pending variant count, with variant names in the name's
tooltip. A row can start just that mod's updates or ignore updates for all of
its installed variants. Starting one mod keeps the menu open for the others;
the menu closes when none remain. The footer uses the same batch executor.
The mod page's ignore/resume toggle applies to the same full submission and
section. Its state follows all installed variants; resuming also clears a mixed
ignore state left by an earlier per-file toggle or an interrupted save.
Clicking a mod name or its link reveals that installed card, expands its section,
and opens its usual details view or variant picker. Filters are cleared only
when they hide the target.

Each selection is fetched and classified before its jobs enter the existing
download FIFO. Matching uses the same classifier and remaining-file preference
as the details page. VPKs targeting one archive share a download. An already
installed successor is promoted through the same FIFO without another transfer.
One best-effort pre-update recovery snapshot covers the entire batch.

`enqueueManagedDownload` accepts main-only lifecycle callbacks. Replacement
validation runs when its job starts. Installation leaves new VPKs disabled,
regardless of automatic enabling. The queue awaits predecessor cleanup and
enabled, Global, and explicit local-group restoration before emitting completion
or starting the next install. Ordinary Browse downloads use the same FIFO.

Waiting downloads can be reordered by dragging their queue number, filename, or
the gap between them, or using keyboard sorting from the same control.
Rows animate into place during dragging; their order is saved only on drop.
Cancel all beside the queued count removes waiting downloads and manual requests,
including paused transfers. The current download or installation keeps running.
Download now interrupts a transferable job and moves it to the start of the
waiting queue with its saved progress. Extraction, choices, installation, and
finalization finish before the prioritized job starts. Suspended transfers retain
their temporary archive and resume safely; servers that cannot resume cause a
fresh transfer. Queue IDs, phases, and retained progress come from main, so a UI
reload preserves the display. Queue state is not persisted across app restarts.

`modReplacement.ts` shares this executor between Browse and Installed for
details-page updates, reinstalls, and confirmed replacements. Immutable source
identities are checked before a job
starts and again before guarded deletion. Cleanup reuses the existing safety,
[file backups](mod-backups.md), and [Global placement](locker-global-mods.md)
operations. Finalization takes one mod mutation lock and uses
unlocked helpers; network transfers and optional imprint refresh stay outside it.
Cancellation before finalization retains predecessors. Once finalization starts,
it must finish before cancellation or another install can intervene.
Cancelling a download or promotion also closes that operation's pending safety
review without answering other reviews of the same version.

Manual choices are grouped by GameBanana submission and section, separately from
runnable queue entries. They appear after executable downloads and keep the
download popup visible even when nothing is transferring. The queue
uses the same numbered waiting rows, with manual requests pinned to the bottom.
These rows cannot be dragged or prioritized. A Layout-level notice
shows one mod at a time. Dismissing notices or dialogs retains the queue shortcut.
The existing details dialog supplies descriptions, filename tooltips, and the
single-choice or dropdown replacement control. In this view, Replace is the
full-size action and Install is the secondary icon action by default. Preferences
can turn off this swap. Reinstall and Enable are omitted; Update stays available
until that file is queued or updating.
The replacement confirmation has a Don't ask again checkbox, saved when the user
confirms. The skip-confirmation preference defaults off and can be turned off
again to restore the warning. These preferences do not change update matching.

Renderer progress publications are limited to ten per second, with immediate
first and final samples. Queue-only subscribers and queued rows remain stable
between membership changes, and speed readings use a separate 250ms sample
window so transfer chunks cannot continually redraw the whole queue.
Focus refreshes skip active update transfers. Job completions wait for any
older library scan, then share a fresh scan so replaced files stay current even
while manual choices remain. The batch also refreshes when it settles.
Completed files stay busy in details views until a successful library scan that
started after completion has published its results. Advancing the queue cannot
briefly expose the predecessor's stale Update or Replace action during that gap.
The update menu uses the same completion acknowledgement for replaced source IDs.
Flags for a reused local ID are dropped when its GameBanana file identity changes.

Selecting a manual replacement reserves its source and validates the destination
against fresh main-process file details before appending a FIFO job. Removed or
archived destinations leave the original choice available to retry, and new
uploads can be selected without restarting the batch.
Removing the optimistic download during validation excludes that source without
enqueueing it.
Other unresolved source files remain available. A failed choice returns for
retry only if its predecessor still exists with the original identity. Explicit
cancellation or queue removal excludes that work from the batch. Active install
and developer-mode changes, and developer-library replacement, are refused while
downloads or update work remain. Downloads cannot start during a developer-library
copy. Mode changes also reject older queued mod mutations before they can write
to the other sidecar. Normal and developer metadata stay isolated.

Focused tests cover the actual FIFO, finalization ordering, cancellation,
matching, promotions, duplicate destinations, preparation races, source identity,
Global and enabled state, group restoration, backups, and shared renderer UI.
