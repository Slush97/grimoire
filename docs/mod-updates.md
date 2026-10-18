# Queued mod updates

Bulk updates are owned by `modUpdateController.ts` in the main process, with
runtime dependencies in `modUpdates.ts`. State stays in memory and survives
renderer navigation. The Installed toolbar shows `Updating` until both queued
replacements and outstanding manual choices finish or are removed.

Every submission is fetched and classified before the batch enters the existing
download FIFO. Matching uses the same classifier and remaining-file preference
as the details page. VPKs targeting one archive share a download. An already
installed successor is promoted through the same FIFO without another transfer.
One best-effort pre-update recovery snapshot covers the entire batch.

`enqueueManagedDownload` accepts main-only lifecycle callbacks. Replacement
validation runs when its job starts. Installation leaves new VPKs disabled,
regardless of automatic enabling. The queue awaits predecessor cleanup and
enabled, Global, and explicit local-group restoration before emitting completion
or starting the next install. Ordinary Browse downloads retain their FIFO order.

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
download popup visible even when nothing is transferring. A Layout-level notice
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

Selecting a manual replacement reserves its source and appends a FIFO job.
Other unresolved source files remain available. A failed choice returns for
retry only if its predecessor still exists with the original identity. Explicit
cancellation or queue removal excludes that work from the batch. Active install
and developer-mode changes, and developer-library replacement, are refused while
the session has work remaining. Normal and developer metadata stay isolated.

Focused tests cover the actual FIFO, finalization ordering, cancellation,
matching, promotions, duplicate destinations, preparation races, source identity,
Global and enabled state, group restoration, backups, and shared renderer UI.
