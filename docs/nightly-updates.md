# Stable and Nightly updates

Settings > Updates selects the update channel. Stable is the default. Choosing
Nightly saves the preference and immediately checks for the newest successful
main build. Users still choose when to download and install it.

To verify a fix, ask the reporter to select Nightly and install the offered
update. The installed version includes its build time and commit hash, so it
can be included in the follow-up report.

Switching back to Stable checks for the current official release. An installed
nightly can return to that release even when its version is lower. Switching
channels discards any previous channel's pending update and prevents its
installer from running on exit. Channel changes wait for an active check or
download to finish.

Windows installers and Linux AppImages use the existing in-app updater. macOS
still needs a manual download because the app is ad-hoc signed; the download
link points to the selected release. System package installs keep using their
package manager and do not offer the selector. Nightlies do not publish to the
stable APT, AUR or Flatpak repositories.

## Publishing

`nightly.yml` runs after CI succeeds for a push to this repository's main
branch. It packages that exact commit on Windows, Linux and Apple Silicon
macOS using `package.yml`, also used by stable releases. Outdated commits and
already published commits are skipped. The manual trigger requires a successful
main CI run for the same commit too.

The nightly version is the next patch after package.json, followed by
`-nightly.<UTC build time>.<workflow run number>.g<commit>`. For example,
main at `1.31.0` produces `1.31.1-nightly.20261009123000.42.gabcdef0`. This sorts
above the installed `1.31.0` stable release. The override is passed to the
packager; package.json and the lockfile are not changed.

All platform builds must succeed before publishing. The release stays a draft
while assets upload, then becomes a prerelease without becoming GitHub's latest
stable release. It contains only `nightly*.yml` update metadata. Only the newest
published nightly is retained; stable releases are untouched. The stable
tag workflow also excludes nightly tags.

The workflow starts publishing once this change is on main and CI passes.
Stable users need a normal release containing the selector before they can opt
in through the app. Until then, testers can download a nightly directly from
GitHub Releases.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm ui:check`, `pnpm test`,
`node --test scripts/nightly-version.test.mjs`, and the i18n checks. The updater
tests cover persisted preferences, return to Stable, in-flight operations and
discarding a downloaded installer after a channel change. Provider tests use
the installed electron-updater with mocked HTTP to check release selection,
platform-specific metadata and version comparisons.

Run actionlint on the workflows, then package a Windows build with
`--publish never`, the nightly version override, `publish.channel=nightly` and
`generateUpdatesFilesForAllChannels=false`. Verify `nightly.yml` exists and no
`latest*.yml` is generated. A live GitHub publishing run is still required to
verify all three hosted platforms and release uploads.
