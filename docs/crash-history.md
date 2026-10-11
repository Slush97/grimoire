# Deadlock crash history

Settings > Support lists available Deadlock minidumps from the game and Steam
folders. Reports are read when Support opens, on window focus and on Refresh.
The list includes older crashes, generic exceptions and unreadable dumps.
The advisory detector's quiet baseline and 14-day limit do not filter it.
Nothing is uploaded, deleted or changed automatically.

Matching process IDs, dump timestamps and exception codes group duplicate
Steam/game copies. Reports without a process ID stay separate. The list loads
50 rows at a time. File signatures cache bounded diagnostic reads; dump memory
is never read for the list or textual support report.

Only previously recorded fatal-resource incidents supply a suspected mod and
game build. Their recorded context can survive dismissal or installation of a
mod update, while it remains in advisory history. Older reports without that
context do not borrow the current mod configuration or current game build.

Users can select up to ten crashes for the existing Generate report action.
The textual export uses the same redaction rules as Grimoire's own log and
includes at most 64 KB of diagnostic comments per crash. Raw dumps are not
bundled into this report. Save original dump copies the selected file after
the user chooses a destination. Show file reveals an existing copy.

The UI uses opaque report IDs. The main process resolves them to discovered
files and checks their signatures again before viewing, revealing or copying.
If Steam removed one copy, another copy can be used. If no copy survives,
the UI asks the user to refresh; ordinary mod and report actions stay available.
