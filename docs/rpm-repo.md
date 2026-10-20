# dnf repository (Fedora)

Grimoire ships a dnf repository at `https://rpm.grimoiremods.com` so Fedora
users can install and update through `dnf` (or GNOME Software / Discover)
instead of downloading an `.rpm` each release.

Same reason as the apt repo: the rpm installs to `/opt/Grimoire`, which
`getInstallSource()` in `electron/main/services/updater.ts` treats as `managed`,
so the in-app updater is off and dnf has to deliver updates.

## How it works

- Build: `electron-builder.yml` has an `rpm` Linux target. The `package.yml`
  linux job installs `rpm` for `rpmbuild` and ships `grimoire-<version>.x86_64.rpm`
  on the GitHub release like every other asset (hashed, attested).
- Hosting: the same `grimoire-apt` R2 bucket, under `rpm/`. The `grimoire-apt`
  Worker answers `rpm.grimoiremods.com` and maps each path to `rpm/<path>`.
  It counts setups, update checks, metadata refreshes and package pulls the
  same way it does for apt, in separate tables, served at
  `rpm.grimoiremods.com/__count` and `/__stats` (see `grimoire-apt/README.md`).
- Publishing: the `rpm-publish` job in `.github/workflows/release.yml` runs on
  each tagged release. It signs a copy of the rpm with `rpmsign`, builds
  metadata with `createrepo_c`, signs `repomd.xml`, and syncs a fresh
  latest-only repo to `rpm/` with `--delete`.
- Signing: it reuses the apt key (`APT_GPG_PRIVATE_KEY`, ed25519), so dnf shows
  "Grimoire Apt Repo" as the key's name on first install. The package gets signed in
  the publish job rather than the build job so the key never shares a runner
  with `pnpm install`. The GitHub release rpm is therefore unsigned, and the
  repo copy is not byte-identical to it. dnf skips signature checks on a local
  file, so `dnf install ./grimoire-*.rpm` still works.
- Packaging: the `rpm:` block in `electron-builder.yml` turns off
  `/usr/lib/.build-id` links (they collide with any other rpm on the same
  Electron), makes the package own its directories so uninstall removes
  `/opt/Grimoire`, adds `libsecret` for safeStorage, and swaps in
  `resources/rpm-after-remove.tpl` so an upgrade doesn't delete
  `/usr/bin/grimoire`.
- Scope: `x86_64` only.

The job is gated on the repo variable `RPM_PUBLISH_ENABLED == 'true'`.

## One-time setup

Assumes the apt repo is already live (R2 bucket, R2 token, signing key and
secrets from `docs/apt-repo.md`).

1. Deploy the Worker so it claims `rpm.grimoiremods.com`:
   ```bash
   cd ../grimoire-apt && npx wrangler deploy
   ```
   (Not `pnpm deploy`: that is pnpm's own workspace command, not the script.)
2. Repo **Settings > Secrets and variables > Actions > Variables**: set
   `RPM_PUBLISH_ENABLED` to `true`.
3. Cut a release. Re-running a release workflow only backfills tags that
   already build an rpm; v1.32.0 and earlier don't.
4. Check it:
   ```bash
   curl -fsSL https://rpm.grimoiremods.com/grimoire.repo
   curl -fsI  https://rpm.grimoiremods.com/repodata/repomd.xml
   curl -s    https://rpm.grimoiremods.com/__count     # {"count":N,"installs":M}
   docker run --rm fedora:latest bash -c 'curl -fsSL -o /etc/yum.repos.d/grimoire.repo https://rpm.grimoiremods.com/grimoire.repo && dnf -y install grimoire'
   ```

## User install instructions

```bash
sudo curl -fsSL -o /etc/yum.repos.d/grimoire.repo https://rpm.grimoiremods.com/grimoire.repo
sudo dnf install grimoire
```

dnf asks to import the signing key on first install. Updates come through
`sudo dnf upgrade` or the desktop's software center. The repo file sets
`metadata_expire=6h`, so a new release shows up within six hours.

Atomic Fedoras (Bazzite, Silverblue, Kinoite) should use the AppImage, which
updates itself: rpm-ostree doesn't handle packages that install into `/opt`
well, and the Flatpak bundle has no update source.

Verified on Fedora 43, 44 and 45 (dnf5, rpm 6.0 and 6.1) with an ed25519 key,
the rpm built and the repo signed on Ubuntu 24.04 like CI, served through the
Worker: signed install, `dnf upgrade --refresh` to a newer latest-only publish
with `/usr/bin/grimoire` intact, a tampered `repomd.xml` rejected with "Bad PGP
signature", uninstall leaving nothing in `/opt`, a local install of the unsigned
release rpm, and the app launching to its setup screen.
