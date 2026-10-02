# Mod inspection

Off by default: turn it on under Settings > Experimental Features > Mod safety.
It was built against a Deadlock bug that let a HUD script point a
`CitadelHTMLPanel` at `javascript:` or `file://` URLs and read local files.
Valve has since closed that: `SetURL` now blanks anything not starting with
`https://`. With the review off, every gate below passes without reading the
archive, startup skips the installed-mod check, and local imports land enabled.

With it on, Grimoire checks VPK content before downloads finish, before local imports become
active, before enabling mods, when applying profiles or batches, before committing
merge/repack outputs, before joining a Deadworks server, at startup, and before
launching a modded game. DMM adoption and vanilla-stash restoration also pass
through the gate.

The decisions are:

- **Can't check:** an unreadable/malformed archive, unsafe archive paths, a missing
  chunk file, decoder failure or inspection resource limit. This is
  an installation/read error, not a malware verdict, and cannot be overridden.
- **Check incomplete:** the inspector itself failed (worker could not start,
  crashed, ran out of memory or timed out, or the decoder is missing). This says
  nothing about the mod. It is never cached, never moves a mod at startup and is
  retried on the next gate or **Check installed mods**. Activation and launch
  still refuse the mod until a check completes.
- **Review:** scripts or executable UI content, including local-file/UNC access,
  embedded browsers, network APIs, dynamic code, opaque scripts and bundled programs.
  Users see the specific risks and choose **Keep disabled** or **Allow this version**.
  Recognized capabilities never prohibit informed consent. Passive models, artwork, audio, styles and layouts without
  executable behavior do not require consent. Unknown asset types alone do not
  generate findings.
  This includes minified scripts. Accepting means trusting
  their source, not that the scanner has proved them harmless.
- **No findings:** content without detected executable behavior. This is not a safety
  certification or a defense against native game resource-parser vulnerabilities.

JavaScript is parsed with Acorn without executing it. String escapes, literal
concatenation, simple bindings, computed member names and inline handlers are
inspected. This does not solve arbitrary obfuscation: scripts require consent
even when no dangerous token is recognized. XML/HTML/SVG and compiled LaCo layouts
are checked for scripts, event handlers and browser behavior. A static image
reference alone is not treated as code execution.
Known model/skeleton/animation formats are treated as assets. Classification never
depends on the mod's name, author or advertised category.

The VPK reader validates the directory tree, names, bounds, duplicate paths and
resource limits before reading contents. It handles preload bytes and compiled
Panorama DATA. The shipped, hash-pinned vpkmerge v0.19.1 (or the binary a distro
package names in `VPKMERGE_BINARY`) decodes LaCo layouts in a temporary
directory. Its extraction-path protection prevents directory traversal;
it does not prevent a game script from navigating CEF to a local file.

Unknown entry formats do not require review. Malformed resources, decoder failures and excessive source
sizes are blocked. Multipart archives are read through their `_dir.vpk`, and
every referenced `_NNN.vpk` chunk is inspected and hashed into the fingerprint.
Every move of an installed archive (enabling, disabling, Global moves, load-order
changes, the enabled/disabled name-collision repair and the startup check) carries
its chunk files, and deleting a mod deletes them. A chunk file without its
`_dir.vpk` is not mountable and is not inspected on its own, but its slot counts
as taken. A shield follows the file it describes through moves and is dropped once
those bytes are replaced. Limits: 16 MiB directory,
100,000 entries, 8 MiB per inspected source, 64 MiB combined sources, 128 compiled
layouts, 30 seconds per decoder invocation, 120 seconds per worker. Nested VPKs
are inspected recursively with shared entry/source budgets, up to four nested
levels, 64 nested archives, 128 MiB per nested archive and 256 MiB combined nested
bytes. Neither script contents nor nested packages are executed during inspection.

Trust is local to this Grimoire installation and keyed by SHA-256 of the full
physical package, referenced chunks, and policy version. It is not imported from
mod metadata, profiles, a filename, an author, or a GameBanana ID. Inspection
reports are cached locally by content hash and scanner version, so unchanged
packages do not need decoding and analysis again. A gate rehashes a package
unless every file it covers keeps the device, inode, size, mtime and ctime it had
when last hashed, so startup and launch checks don't reread an unchanged library.
Rewriting a file while restoring its ctime takes code already running as the user.
Acceptance rechecks the current bytes against the reviewed fingerprint. Merges,
merge rebuilds and imprints are new bytes built only from installed archives
plus Grimoire's own `addoninfo.txt`/`modinfo.json` entries. When every source is
trusted and the new archive has no finding they lack, the approval carries to it
without asking again: the user already allowed that content to run together.
An imprint of a mod still awaiting review stays awaiting review. Anything else,
including a merge with an unreviewed source, is reviewed as a new version.

Unmerging or extracting from a merge re-enables each source through the normal
gate. A source kept disabled there stays in the disabled library and the rest of
the unmerge completes. Staging copies from merges, imprints and imports that an
earlier session left behind (a crash, or quitting mid-review) are removed on
the next library scan.

The Mod safety sidebar page shows mod thumbnails and risk summaries together. Each mod expands
in place for explanations, affected files and its decision. Card shields open the
corresponding row directly. Inline approval sends the displayed fingerprint to the
main process, which rechecks the current bytes before saving consent; enabling the
mod then passes through the normal activation gate. Downloads and other pending
decisions appear on the same page, without a second confirmation dialog, on the
mod's own row when the archive is installed. A decision on a version answers
every operation already waiting on it (an enable, profile apply, merge or
install), which then continues or stops. Answering never waits on the mod
library lock those operations hold, and a change still queued on one row does
not block answering another. The
dismissible library notice returns for new versions needing review and disappears
when none remain. An optional visual explainer illustrates legitimate uses and
why unexpected access deserves scrutiny.

Local imports are staged and inspected, then committed to the disabled library.
The batch finishes and its dialog closes before navigation to Mod safety. Passive
and previously approved imports also remain disabled until enabled by the user.
Partial failures retain successful disabled imports and leave failed sources
available to retry in a closable import dialog.

Batch toggles (launch shuffle, solo launch and its restore) review every mod they
would enable before moving any file. A mod that is declined or fails the check
stays off and counts as a failed toggle; the rest of the batch still applies. The
launch shuffle never picks a file already known to fail the check, and a solo
launch whose target stayed off does not start the game.

Rejected download candidates are retained under `userData/mod-quarantine` when
possible, with a report: one copy per version, removed once that version is
approved and pruned at startup after 30 days or beyond 2 GiB in total. Refusing
to enable a library mod copies nothing. Candidates already staged in the
disabled library stay disabled. The previous version is not removed by the update flow until the final
candidate passes inspection and consent. Startup moves untrusted active VPKs
into the disabled library while the game is closed; it does not delete them. If
Deadlock is running or a move fails, the UI reports that the file may still be
active. Close the game and run the installed-mod check again. Unapproved VPKs
restored after a vanilla launch go to the disabled library, chunks and metadata
included, instead of back into a game folder.

Inspection applies to Grimoire's configured priority/addon roots and disabled
library. Deadworks server addons live in `citadel/deadworks_addons/vpks`, which
every launch mounts. They are checked under the server's name when you join: a
download before it is moved into that folder, and that server's addons already
there on every join. Declining, a blocked result or an incomplete check cancels
the join and deletes that addon, so the next join downloads and checks it again.
Startup and launches do not check that folder: an addon downloaded before this
check existed stays mounted until you join its server again. Deadworks map
downloads (`citadel/maps`) are not inspected.

Inspection does not police custom SearchPaths, loose files installed by other
tools, changes made while Grimoire is closed, or launches directly from Steam.
It cannot unload code already loaded into Deadlock. There is no OS firewall rule
or game-runtime sandbox here. A complete fix for the underlying file-access and
egress capability requires enforcement in the game/CEF runtime.

This is a script-focused gate, not a proof that an archive contains no executable
behavior. It does not semantically decode every resource type (for example, opaque
map/entity or generic-data formats). The engine could interpret those resources in
ways this scanner does not recognize; no-findings is not a sandbox guarantee.

No package contents or inspection findings are sent to a remote service.
