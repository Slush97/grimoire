# Deadworks server browser

Lets Grimoire users browse and join Deadworks community dedicated servers from a
**Servers** tab. Gated behind the `experimentalDeadworksServers` setting.

Joining is fully cross-platform: nothing here needs the Windows `deadworks.exe`.
Hosting a Deadworks *game server* still requires Windows (Valve ships no Linux
Deadlock dedicated binary), but that is out of scope for the client.

## Data flow

```
Servers.tsx ── api.ts ── IPC (ipc/servers.ts) ── services/deadworksServers.ts ── relay HTTP
                                                                              └── Steam (steam://connect)
```

1. **List**: `GET <relay>/v1/servers` (falls back to `/api/servers` for a
   deadworks-shaped relay). Each row is A2S-pinged over UDP (`pingServer`).
2. **Join** (`prepareAndConnect`):
   - `GET <relay>/v1/servers/:id/content` -> manifest of `.vpk.bz2` items
     (`kind: map | addon`, `version`, `download_url`).
   - Ensure `gameinfo.gi` mounts the deadworks content path (see below).
   - For each item not already at the manifest `version`: download the
     `.vpk.bz2`, decompress via the bundled 7-Zip (`7zip-bin`), verify the VPK
     magic (`0x55aa1234`), pass an addon through the mod safety gate, then
     atomically rename onto the canonical path. A
     `deadworks_cache/versions.json` ledger skips downloading already-current
     files; current addons still pass the gate on every join.
   - Open `steam://connect/<ip:port>` via `shell.openExternal`.

Maps land in `citadel/maps`; addons in `citadel/deadworks_addons/vpks`.

## gameinfo.gi integration (the load-bearing part)

Grimoire merges its managed `Game` entries into `SearchPaths` in `gameinfo.gi`
(`system.ts`, `gameinfoSearchPaths.ts`). Valve's language/low-violence mounts,
comments, and unrelated custom paths are preserved. Missing stock mounts from
older Grimoire rewrites are restored. The Deadworks content path is a conditional
member of the managed addon group, exactly like overflow folders:

- `deadlock.ts` exposes `DEADWORKS_SEARCH_PATH = 'citadel/deadworks_addons/vpks'`
  and `hasDeadworksContentRoot()`.
- `buildSearchPathsBlock(overflow, includeDeadworks, body, eol)` appends
  `Game  citadel/deadworks_addons/vpks` as the **last** entry of the addon group
  (lowest precedence, so user mods always win a file collision).
- `getGameinfoStatus` / `fixGameinfo` treat the deadworks line as required
  **whenever content has been provisioned** (the vpks folder exists), so a game
  update that resets `gameinfo.gi` is flagged and repaired, and the line
  survives every repair.
- `ensureDeadworksSearchPath()` is the connect-time guard: a no-op when the
  block is already correct, otherwise a preserving merge. It runs *before*
  downloading so a locked/unparseable `gameinfo.gi` fails fast with a clear
  "close Deadlock and try again" message.

Why a `Game` search path and not Deadworks' `addonroot`: loose VPKs in a Game
search path are how grimoire's whole mod system already mounts content, it
coexists cleanly with `citadel/addons` and the overflow folders, and it keeps
server content off the user's 99-slot `pakNN` budget.

## Relay

The directory is served by `grimoire-relay` (separate CF Worker, see that
repo's CLAUDE.md). Wire types mirror `grimoire-relay/src/shared/schemas.ts`;
the client copy is `src/types/deadworks.ts` (keep additive and in sync). The
relay URL is configurable (`deadworksRelayUrl` setting), defaulting to the
built-in `https://relay.grimoiremods.com`; any deadworks-shaped relay works.

## Security / conventions

- Manifest filenames are validated as a single safe path component (mirrors the
  relay's Zod guard) before any filesystem write.
- A 4 GiB decompression ceiling bounds a bz2-bomb manifest.
- Addons are mounted on every launch, so each one goes through `assertVpkSafety`
  (context `server`, named after the server) before the join dials. The user can
  allow a flagged version on the Mod safety page. A declined, blocked or
  incomplete check deletes that addon and its ledger entry and returns
  `method: 'safety'` without opening `steam://connect`. Maps are not inspected.
  See `docs/mod-inspection.md`.
- No telemetry: unlike the upstream Deadworks launcher, Grimoire sends no
  install/heartbeat pings.
