# Viewer work in Codex Cloud

Research checked against official OpenAI documentation on 2026-09-30. This guide describes a proposed setup. It has not been run or validated in a Codex Cloud VM.

Code changes, CLI extraction, unit tests, and builds can move to a cloud environment. Keep Windows Electron, GPU, and in-game comparison as final validation steps. Current Codex Cloud documentation lists computer and browser use as unsupported. Whether terminal-installed headless Chromium with software WebGL works in the selected VM needs a separate setup test.

## Source checkpoint

| Input | Value |
| --- | --- |
| Writable repository | `https://github.com/oldreceipt/grimoire.git` |
| Upstream repository | `https://github.com/Slush97/grimoire.git` |
| Viewer branch | `feat/viewer-parity` |
| Upstream base | `528f1f09cc3ae19ef0a36de6169f44744c0992aa` |
| Shared types repository | `https://github.com/Slush97/grimoire-social.git` |
| Shared types revision used locally | `efffe0b92a49d6cc8d82406d6fc163c2fd3662a5` |
| Exporter | `vpkmerge v0.19.1`, platform asset and SHA-256 pinned in `scripts/fetch-vpkmerge.mjs` |

Before cloud checkout, finish the local work, record its final commit SHA, and push `feat/viewer-parity` to the fork. Supply that SHA and the remaining work in the cloud task prompt. Do not assume a cloud task receives local uncommitted files, ignored assets, running processes, browser sign-ins, or personal skills. Keep branch names outside `codex/`.

Read `AGENTS.md` and `docs/viewer-reference-audit.md` in the cloud checkout. Include the representative Dynamo, Wraith, Mirage, and Yamato cases, known limitations, and current validation results in the task handoff.

## Create the environment

In a new Codex task on desktop or web, choose **Work in > Cloud > Select environment > Create environment**. Select both repositories above and connect GitHub if prompted. Ask Codex to prepare the layout and checks below. Review the setup report, resolve failures, save, and publish. Start a new task after **Environment published** appears.

The current experience uses published reusable environments, with a separate workspace for each task. The official docs identify the older setup-script/container experience as **Codex Cloud (Legacy)**. Follow the current guide for desktop and web. Local app tools can create a separate cloud conversation, but the current `handoff_thread` tool does not migrate a local chat to cloud execution.

Sources: [Codex Cloud overview](https://learn.chatgpt.com/docs/cloud), [current environment setup](https://learn.chatgpt.com/docs/environments/cloud-environments#create-and-publish-an-environment), [execution modes and local resources](https://learn.chatgpt.com/docs/environments/modes).

## Reproduce the repository layout

The repositories must be siblings:

```text
workspace/
  grimoire/
  grimoire-social/
```

Grimoire's TypeScript and Vite aliases point directly to `../grimoire-social/packages/social-types`. Pin the shared types checkout to the recorded revision for reproduction, then assess newer shared types separately. Install that repository's dependencies too: its shared package requires Zod from its own dependency tree.

Use **Node 20 and pnpm 10**, matching `.github/workflows/ci.yml`. Recreate the gitignored `grimoire/pnpm-workspace.yaml` during setup:

```yaml
packages:
  - "."
  - "../grimoire-social/packages/social-types"
```

Install dependencies with the committed lockfiles:

```bash
cd /path/to/workspace/grimoire-social
pnpm install --frozen-lockfile
cd ../grimoire
pnpm install --frozen-lockfile
```

Do not copy the Windows `node_modules` junction or regenerate and commit a lockfile from a differently named worktree. The install script downloads the checksum-pinned Linux x64 exporter on a supported Linux x64 environment. For running Electron after an install that touched its native module, follow the repository's `pnpm exec electron-rebuild -f -w better-sqlite3` instruction. The cloud build/test path should first match the existing Ubuntu CI path; an Electron runtime additionally needs suitable system libraries and a display setup.

## Environment and network

Set this direct environment variable in the environment configuration:

```text
GRIMOIRE_SOCIAL_BASE_URL=https://grimoire-social.slusheliott.workers.dev
```

It is a public build configuration value. Viewer build and unit tests do not require production Cloudflare deployment credentials, Steam API credentials, or social administration tokens. Building with the URL does not require deploying or modifying that service.

Allow dependency downloads using the documented **Package managers** network preset. It includes npm, Ubuntu/Debian packages, GitHub source and releases, and release-asset hosts. Test Electron downloads and any additional tool downloads during setup; if blocked, add the exact destination hostname. Allowing a domain does not grant authentication or repository write permissions. Confirm the connected GitHub account can access both repositories and write the fork when pushes or PRs are later authorized.

For any separately authorized private fixture service, configure only its required hostname and access value. Use a network secret for credentials sent to an allowed HTTPS service, or a direct variable if a program must read the actual value. No credentials need to be added for the public build URL above.

Sources: [installation and startup](https://learn.chatgpt.com/docs/environments/cloud-environments#customize-installation-and-startup), [network access](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-services), [variables and network secrets](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets).

## Assets and preview startup

Git ignores `.codex-run/`, generated GLB/cloth/particle assets, and `resources/vpkmerge/`. The exporter is reproducibly fetched at install time; the installed Deadlock game and preview fixtures are separate inputs.

At the research checkpoint, the local five-hero preview fixture directory contained about **780 MiB**. The installed `pak01*.vpk` set contained **34,135,842,418 bytes**, about **31.8 GiB**. The documented standard cloud VM disk is **8 GiB for Plus/Edu Plus** or **32 GiB for Pro/Business/Enterprise/Edu/Edu Pro**. A full local VPK copy therefore leaves insufficient practical room for dependencies and outputs on a standard 32 GiB VM. Account access and available VM configuration have not been verified here.

Prefer an explicitly supplied private subset of representative fixtures for renderer and solver work. Do not automatically commit proprietary game assets to the public fork or assume copying just `pak01_dir.vpk` supplies its referenced archive chunks. Fresh extraction requires an appropriate complete input archive set, or a separately approved private asset service/larger supported environment.

The extraction mode of `scripts/preview-cloth.mjs` exports from the game before starting its Vite server. It reads local Windows settings when available, otherwise requires `--game`, and expects `game/citadel/pak01_dir.vpk`. The preview uses `.codex-run/source2-physics/cases.json`, per-case metadata, GLBs, cloth JSON, and any material/particle sidecars required by the current case. The handoff adds a fixture-only `node scripts/preview-cloth.mjs --serve-only --grimoire` path; verify it is present in the final pushed checkpoint and use it after delivering the private pack. Its server binds `127.0.0.1:5176`; that local URL is not automatically available on the user's computer.

Test any cloud headless rendering path during setup before including it as an acceptance gate. Hosted browser/computer-use support is currently documented unavailable. Preserve local screenshot comparisons and Windows packaged-app checks even if a headless rendering probe succeeds.

Sources: [VM limits](https://learn.chatgpt.com/docs/environments/cloud-environments#vm-specifications), [current limitations](https://learn.chatgpt.com/docs/environments/cloud-environments#current-limitations).

## Validation checkpoint

Run the same gates as the repository CI, then record their outputs with the final source SHA:

```bash
pnpm typecheck
pnpm lint
pnpm ui:check
pnpm i18n:check
node scripts/gen-locale-manifest.mjs --check
pnpm test
pnpm build
```

Run targeted viewer animation, material/color, cloth, and particle tests while working. Existing CI already builds and tests on Ubuntu, which supports the portability plan, but does not prove this cloud environment or its rendering path.

The latest local full-suite checkpoint reported by the viewer work is **2,166 passed, 16 failed, 15 skipped across 141 files**. Seven test files failed, and the existing Wine test path reported one unhandled error. The 16 known baseline failures concern platform mocks for Wine/Bottle/Steam, CRLF fixtures, Windows path-separator expectations, and stale hero-roster expectations. Typecheck, lint, UI conventions and the locale manifest check passed locally. Reassess failures on the cloud operating system and against the recorded base; do not suppress the suite or describe a partial passing run as the full suite. Keep exact failing test names and outputs with the handoff evidence.

The installed CLI exposes `codex cloud exec --env <ENV_ID> --branch feat/viewer-parity`, plus status, diff, and apply commands. Use it only after the environment is published and the intended source commit is accessible. No cloud task was submitted as part of this research.

Source: [CLI cloud commands](https://learn.chatgpt.com/docs/developer-commands#codex-cloud).

## Work Cloud with local computer access

ChatGPT Work Cloud with local computer access is a separate option for continuing an eligible task from other devices while using the connected Windows machine. It requires the supported sync/local-access configuration and a **new task after enabling it**. The machine must remain online for steps needing its files, game assets, or tools. If it is unavailable, a cloud container cannot access those resources. Existing local Codex history and execution do not automatically migrate through this feature.

This option retains the local dependency for extraction and Windows rendering. A published Codex Cloud repository environment instead supports independent coding work while the PC sleeps, subject to the asset and visual-validation limits above.

Source: [Work across devices](https://learn.chatgpt.com/docs/get-started-with-work#continue-work-across-devices).
