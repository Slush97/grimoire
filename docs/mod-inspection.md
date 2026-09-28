# Mod inspection

Grimoire checks VPK content before downloads finish, before local imports become
active, before enabling mods, when applying profiles or batches, before committing
merge/repack outputs, at startup, and before launching a modded game. DMM adoption
and vanilla-stash restoration also pass through the gate.

The decisions are:

- **Blocked:** a recognized local-file/UNC address in executable content, embedded-browser capability,
  remote script or network API, dynamic code execution, or bundled programs.
  Malformed/unreadable archives are also unavailable, shown as **Can't check**.
  There is no user override for these decisions.
- **Needs review:** scripts or executable UI content without a recognized
  blocked operation. Passive models, artwork, audio, styles and layouts without
  executable behavior do not require consent. Unknown asset types alone do not
  generate findings.
  This includes minified scripts. Accepting means trusting
  their source, not that the scanner has proved them harmless.
- **No findings:** only supported content without findings. This is not a safety
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
rehashes current bytes. Acceptance triggers another scan to detect changes during
review. Repacking also changes the hash and may require another review.

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
