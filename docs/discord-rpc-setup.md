# Discord Rich Presence setup

Grimoire can show what you are doing in the app on your Discord profile (browsing
mods, in the Hero Locker, designing a crosshair, and so on), with buttons that
link to the site and the Discord server.

## How it behaves (and why it's opt-in)

Rich Presence talks **only to the user's locally-running Discord client** over an
IPC socket (`$XDG_RUNTIME_DIR/discord-ipc-0` on Linux, `\\?\pipe\discord-ipc-0`
on Windows). Grimoire itself opens **no network connection** and sends nothing to
any Grimoire server, so the offline-first / no-phone-home promise holds.

It does, however, broadcast activity outward through Discord. To stay consistent
with the no-telemetry trust pillar it is **off by default** and lives behind a
toggle in Settings -> Preferences -> "Discord Rich Presence". The toggle copy
spells out exactly what it shares.

## Code layout

- `electron/main/services/discordRpc.ts` - owns the connection lifecycle, the
  per-surface wording, the art keys, the buttons, the elapsed timer, and the
  rate-limit throttle (Discord allows 5 activity updates / 20s).
- `electron/main/ipc/discord.ts` - `discord:update` / `discord:clear` handlers.
- `src/components/DiscordPresence.tsx` - headless renderer component (mounted in
  `Layout`) that reports `{ surface, count }` on navigation, debounced.
- `settings.discordRpcEnabled` - the opt-in flag (default `false`).

Library: [`@xhayper/discord-rpc`](https://github.com/xhayper/discord-rpc) (the
maintained TypeScript fork of the deprecated `discord-rpc`). Pure JS, so no
`electron-rebuild` step.

## Portal steps to light it up

`DISCORD_CLIENT_ID` in `discordRpc.ts` is already set to the Grimoire Application
ID, so the feature is live once the user opts in. (Blanking that constant is the
kill switch: an empty string makes every presence call no-op.) **One portal step
remains** before the art renders:

- **Upload the logo art.** In the [Developer Portal](https://discord.com/developers/applications),
  open the Grimoire app (the **same** application that owns the
  `grimoire-discord-setup` bot), go to **Rich Presence -> Art Assets**, and upload
  a square Grimoire logo with the asset key **`grimoire_logo`** (this is the
  `largeImageKey` the service references). The source PNG lives at
  `resources/grimoire-logo-accent.png`. Assets can take a few minutes to propagate
  after upload; until then the large image renders empty but everything else works.

For reference, the Application ID was copied from **General Information ->
Application ID** of that shared app. It is a **public, non-secret** value (not the
bot token), which is why it is safe to ship in client source.

## Notes and gotchas

- **The first presence line is the application's Name.** Discord renders RPC as
  "Playing &lt;app name&gt;", so the top line of the card is whatever the app is
  named in the portal. If the shared bot app isn't already named `Grimoire`,
  rename it (note: this also renames the bot's application).
- **Testing locally:** run the Discord desktop client and enable
  Settings -> Activity Privacy -> "Display current activity as a status message".
  Then toggle Rich Presence on in Grimoire and navigate around; your profile
  should update per surface with a continuous elapsed timer and both buttons.
- **Known limitation:** Flatpak/Snap sandboxes can hide the Discord IPC socket
  from Grimoire; presence may not connect there. The app degrades quietly (no
  errors, presence simply absent).
- **Per-hero Locker art (already implemented):** when a user opens a hero in the
  Locker, the presence shows that hero's icon as the large image and the logo as
  the small badge ("Customizing &lt;hero&gt;"). The icon is the hero's public
  Deadlock wiki image, passed as the activity `large_url` (external image), so
  **no per-hero assets need uploading to the portal**. The Locker page publishes
  the open hero's display name to the store (`lockerHeroName`); `DiscordPresence`
  forwards it; `discordRpc.ts` maps name -> wiki URL via `heroIconUrl()` (one
  override: `Doorman` -> `The_Doorman`). The `grimoire_logo` asset is still what
  shows as the small badge, so uploading it (step 2 above) is what makes the
  badge appear.
- **Adding surfaces / going richer later:** extend `SURFACE_PRESENCE` in
  `discordRpc.ts`.
