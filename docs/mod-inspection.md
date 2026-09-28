# Mod inspection

Grimoire checks VPK content before downloads finish, before local imports become
active, before enabling mods, when applying profiles or batches, before committing
merge/repack outputs, at startup, and before launching a modded game. DMM adoption
and vanilla-stash restoration also pass through the gate.

The decisions are:

- **Can't check:** an unreadable/malformed archive, unsafe archive paths, unsupported
  multipart installation, decoder failure or inspection resource limit. This is
  an installation/read error, not a malware verdict, and cannot be overridden.
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
Panorama DATA. The shipped, hash-pinned vpkmerge v0.19.1 decodes LaCo layouts in a
temporary directory. Its extraction-path protection prevents directory traversal;
it does not prevent a game script from navigating CEF to a local file.

Unknown entry formats do not require review. Malformed resources, decoder failures, excessive source
sizes, and multipart archives are blocked. Multipart content can be read, but
Grimoire's current slot renaming does not move chunk sets transactionally. The
scanner therefore cannot approve them for activation. Limits: 16 MiB directory,
100,000 entries, 8 MiB per inspected source, 64 MiB combined sources, 128 compiled
layouts, 30 seconds per decoder invocation, 120 seconds per worker. Nested VPKs
are inspected recursively with shared entry/source budgets, up to four nested
levels, 64 nested archives, 128 MiB per nested archive and 256 MiB combined nested
bytes. Neither script contents nor nested packages are executed during inspection.

Trust is local to this Grimoire installation and keyed by SHA-256 of the full
physical package, referenced chunks, and policy version. It is not imported from
mod metadata, profiles, a filename, an author, or a GameBanana ID. Every gate
rehashes current bytes. Inspection reports are cached locally by content hash and
scanner version, so unchanged packages do not need decoding and analysis again.
Acceptance rechecks the current bytes against the reviewed fingerprint. Repacking
changes the hash and may require another review.

The Mod safety sidebar page shows mod thumbnails and risk summaries together. Each mod expands
in place for explanations, affected files and its decision. Card shields open the
corresponding row directly. Inline approval sends the displayed fingerprint to the
main process, which rechecks the current bytes before saving consent; enabling the
mod then passes through the normal activation gate. Downloads and other pending
decisions appear on the same page, without a second confirmation dialog. The
dismissible library notice returns for new versions needing review and disappears
when none remain. An optional visual explainer illustrates legitimate uses and
why unexpected access deserves scrutiny.

Local imports are staged and inspected, then committed to the disabled library.
The batch finishes and its dialog closes before navigation to Mod safety. Passive
and previously approved imports also remain disabled until enabled by the user.
Partial failures retain successful disabled imports and leave failed sources
available to retry in a closable import dialog.

Rejected download candidates are retained under `userData/mod-quarantine` when
possible, with a report. Candidates already staged in the disabled library stay
disabled. The previous version is not removed by the update flow until the final
candidate passes inspection and consent. Startup moves untrusted active VPKs
into the disabled library while the game is closed; it does not delete them. If
Deadlock is running or a move fails, the UI reports that the file may still be
active. Close the game and run the installed-mod check again.

Inspection applies to Grimoire's configured priority/addon roots and disabled
library. It does not police custom SearchPaths, loose files installed by other
tools, changes made while Grimoire is closed, or launches directly from Steam.
It cannot unload code already loaded into Deadlock. There is no OS firewall rule
or game-runtime sandbox here. A complete fix for the underlying file-access and
egress capability requires enforcement in the game/CEF runtime.

This is a script-focused gate, not a proof that an archive contains no executable
behavior. It does not semantically decode every resource type (for example, opaque
map/entity or generic-data formats). The engine could interpret those resources in
ways this scanner does not recognize; no-findings is not a sandbox guarantee.

No package contents or inspection findings are sent to a remote service.
