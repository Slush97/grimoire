# Viewer development and validation

Follow `AGENTS.md` for Node/pnpm versions, the sibling `grimoire-social` package
layout, native-module rebuilds and repository gates. Production builds require
the `GRIMOIRE_SOCIAL_BASE_URL` HTTPS endpoint used by the release configuration.
No deployment or administration credentials are required to build the viewer.

## Local asset preview

The harness mounts production components and substitutes Electron asset
transport. With Deadlock installed, export representative cases and start it:

```bash
node scripts/preview-cloth.mjs --game "<game-directory>" --case dynamo,wraith,mirage,yamato --grimoire
```

The complete archive set is required, not only its directory VPK. Generated
models and sidecars remain in ignored `.codex-run/source2-physics`. To serve
existing exports without extracting again:

```bash
node scripts/preview-cloth.mjs --serve-only --grimoire
```

The server binds to `127.0.0.1:5176`; open `/hero-preview.html`. The separate
`/cloth-preview.html` page compares cloth state and optional exporter references.

## Regressions

```bash
pnpm typecheck
pnpm lint
pnpm ui:check
pnpm test
pnpm build
```

Run the i18n and manifest gates from `AGENTS.md` when locale catalogs change.
Focused tests cover material math, model/sidecar loading, playback, camera
controls, constraints, particles, backgrounds and capture. The checked-in cloth
reference JSON contains synthetic numerical regression inputs and outputs;
rendered game fixtures and screenshots are separate local inputs.

## Packaged acceptance

Use a separate output directory and isolated user profile. Do not change
installed mods or settings to make a test pass. Verify actual texture loading
under packaged CSP and inspect nonblank model pixels on the available GPU.

Check complete model/weapon framing, material separation, idle/run cloth,
particle placement, pause/seek/resume, clip changes, camera reset/keyboard,
lighting/bloom, background load/failure, opaque/transparent PNG, GIF review and
fullscreen. Keep rendering serial while collecting evidence so source reloads
cannot invalidate captures.

Separate numerical stability, control/loading checks and appearance acceptance.
Software rendering does not establish native performance, and a nonblank canvas
does not establish exact game parity. Record existing platform/roster test
failures separately from new failures; keep detailed run reports and captures
outside tracked documentation.
