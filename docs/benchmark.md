# Experimental teamfight benchmark

Enable **Settings > Experimental > Benchmark launcher**, then select
**Launch Benchmark** in the sidebar. Close an ordinary Deadlock session first.
The local build starts Midtown, joins as a spectator and runs one warm-up plus
three 30-second measurement windows, each with a five-second lead-in. Setup
adds time: allow about three minutes after loading.

After the third pass, the supervisor closes its game and server. Stop cancels
early; quitting Grimoire also stops the session. Failures and an eight-minute
playback timeout clean up the session. A recovered session record offers Stop
before another launch. These paths target the session's recorded processes
and separate Proton prefixes, rather than every running Wine process.

## Display and evidence

**Use game settings** refreshes the isolated copy from the installed game's
`cfg/video.txt` on every launch. It does not force a resolution. The 720p,
1080p and 1440p options explicitly disable borderless fullscreen and use a
window at that resolution. Other graphics settings, including render scale
and upscaling, are preserved. Window size is not necessarily internal render
resolution. Match both graphics settings and resolution before comparing runs.

Open logs shows the latest session in `userData/benchmark/`. It contains:

- `server-launch.log` and `client.log` for diagnosis.
- `video-settings.txt` and `display.json` for the requested display configuration.
- The exact scenario source and tracks used for that run.
- `result.json` on successful completion, with `score_eligible: false`.

## Automatic frame capture and history

When the supervisor exits, Grimoire opens a results dialog for the saved run.
**Launch Benchmark > View latest results** reopens it, including after an app
restart. The dialog shows average FPS, 1% low, p99 and longest frame time,
recorded duration, frame interval count, FPS over time and frame-time spikes.
Hardware and requested display settings are available under the details fold.

The graphs use the whole capture. Bounded time bins show average FPS and retain
the longest frame in each bin; the first event is the time boundary, matching
the recorder's metric definition. Loading, warm-up and resets remain visible.
No pass-aligned or community-eligible score is inferred from these diagnostics.
Missing, disabled and failed captures have explicit messages instead of zero
scores. Missing frame files leave saved summary metrics visible. Results are
read locally through typed main-process IPC; opening the dialog sends nothing.

The local launcher now requests automatic capture. On Linux with MangoHud
0.8.4 installed, it saves raw frame timings, sensor data, normalized CSVs and
diagnostic average FPS, 1% low and p95/p99 frame times under the session's
`capture/` directory. The recorder uses a transparent overlay because this
MangoHud version does not autostart logging when its HUD loop is disabled.
If the supported recorder is absent, playback can still run and the capture
result explicitly says disabled with a reason.

These initial statistics cover the whole recording, including setup and
warm-up. They are not isolated measured-pass results. Client/capture clock
alignment, recorder overhead and workload fidelity still need validation.
Zero-only sensor fields are labelled potentially unavailable.

`userData/benchmark/ledger.sqlite3` records configuration hashes, UTC dates,
suite/run labels, pass markers, outcomes and artifact hashes. Each session
also has `configuration.json` and `run-ledger.json`. Later notes append to the
history without rewriting the original configuration or results. Frame rows
stay in CSV files. Open test logs provides access to these files. The renderer
can reopen the latest result; a paginated history browser is not implemented yet.

The bundled `benchmark_ledger.py` supports `list`, `note`, `diff`, `export`,
`verify` and `import-session`. Full commands and schema semantics are in the
sibling repository's
`tools/deadlock-benchmark/runtime/CAPTURE_LEDGER.md`. Windows and Metal capture
adapters are currently explicit stubs, not supported live collectors.

## Current scope

This is a Linux-only development feature, off by default. It requires Python 3,
rsync, Modlock CLI and host 0.1.17, Proton and Steam already installed. It does
not install dependencies. The bundled fixture requires Deadlock client 6860;
a different game build blocks launch rather than silently adapting the replay.
The writable game copy uses links to installed VPK assets and consumes roughly
1 GB before per-session logs and Proton prefixes. Retail files are not changed.
Old sessions are retained for diagnosis; remove them only when no session runs.

The fixture is the November 6 Night Shift APAC OT vs PIG8 recording, match
132204644. `resources/benchmark/manifest.json` records its source checksum and
the bundled file hashes. Raw replay downloads are not bundled.

Completion establishes that the automated workload ran, not accurate replay
reproduction or a valid FPS result. Cast counts differ across repetitions,
some casts are rejected, and actor positions can differ from the recorded
path. Gunfire is synthetic. World state, active effects and modifiers are not
fully restored. A local server also uses the measured machine's CPU.

## Upstream patterns reviewed on November 7, 2026

The source review used Modlock commit
`d54df297a5c972aee36ff7b9e1205eb24547f696`. The latest release observed was
[0.1.74](https://github.com/paralin/modlock/releases/tag/v0.1.74), considerably
newer than this fixture's tested runtime. Do not mix its SDK and host with
0.1.17 without rerunning compatibility and runtime checks.

| Reference | Pattern and application here |
| --- | --- |
| [Arena self-test](https://github.com/paralin/modlock/blob/d54df297a5c972aee36ff7b9e1205eb24547f696/examples/arena/probe.ts) | Explicit readiness steps, a deadline and a terminal result. The supervisor additionally owns client cleanup. |
| [Arena console preset](https://github.com/paralin/modlock/blob/d54df297a5c972aee36ff7b9e1205eb24547f696/js/src/console.ts) | Disable ambient troopers, neutral camps, practice bots, zipline starts and idle-server hibernation. These variables are now explicitly applied with the older SDK. |
| [Modlock launcher](https://github.com/paralin/modlock/blob/d54df297a5c972aee36ff7b9e1205eb24547f696/session/session.go) | Wait for server readiness, then launch the stock game through Steam with `+connect`; stop prevents late client launches. The isolated benchmark keeps direct Proton launch to own its separate files and processes. |
| [Freestyle](https://hyperline.gg/mods/freestyle) and [Empty Lot](https://hyperline.gg/maps/hl_empty_lot) | Choose the map before launch. Our fixture declares Midtown in `mod.json`. These pages document the product flow; their private mode implementations were not inspected. |
| [Aim Range](https://hyperline.gg/mods/aim-range) | Fixed-duration runs and explicit eligibility based on hero/loadout. Our reconstruction stays unscored until fidelity and capture are validated. |

Newer Modlock helpers such as `onPlayerJoin`, `Cast` and `ProbeRun` are useful
migration targets. `precache` already exists in the pinned 0.1.17 SDK, but the
replay scenario does not call it yet. The current scenario uses readiness
polling, automatic spectator assignment and a warm-up. Hot reload and browser
preview are disabled. Grimoire passes `--ui-port 0`; direct launcher runs must
also pass it because the Python CLI currently defaults to an enabled interface
service. Modlock's update check is suppressed.

The [runtime setup audit](../../vpkmerge/docs/deadlock-benchmark-results-design.md#runtime-setup-audit-november-7-2026)
records the native camera-mode mistake, upstream spectator fixes, missing
precache, launch-setting differences and the proposed validation order.

## Development checks

Build Grimoire, then run the manual integration check on a desktop with the
dependencies above:

```sh
BENCHMARK_TEST_RESOLUTION=1920x1080 BENCHMARK_TEST_CANCEL=1 \
  node scripts/smoke-benchmark.mjs /path/to/Deadlock
```

The check uses a temporary Grimoire profile, launches via the actual button,
waits for all three passes, then verifies early cancellation. Keep the game's
window visible when checking dimensions or capturing performance data.

## Results UI and aggregation proposal

The [benchmark research and results design](../../vpkmerge/docs/deadlock-benchmark-results-design.md)
documents the Terra agents' review of Deadlock Performance Lab, CompLock and
general capture tools. It proposes History, Run detail and Compare views,
spike-preserving charts, explicit recording/import date sorting, experiment
controls and versioned analysis records. This is a design proposal; those
views and comparison policies are not implemented yet.
