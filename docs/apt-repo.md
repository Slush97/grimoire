# APT repository (Debian / Ubuntu)

Grimoire ships an APT repository at `https://apt.grimoiremods.com` so Debian and
Ubuntu users can install and update via `apt` instead of manually downloading a
`.deb` each release.

This matters because the in-app updater (electron-updater) cannot self-update a
`.deb` install. `getInstallSource()` in `electron/main/services/updater.ts`
already detects `/opt` installs as `managed` and disables the in-app updater,
telling those users to use their package manager. The apt repo is the package
manager channel that message refers to.

## How it works

- Hosting: a Cloudflare **R2** bucket (`grimoire-apt`) served at
  `apt.grimoiremods.com` by the `grimoire-apt` Worker (in the workspace root).
  The Worker streams objects straight from the bucket (R2 has zero egress fees,
  so serving large Electron debs costs effectively nothing) and additionally
  tallies real `.deb` downloads in KV, which powers the apt install-count badge
  in the README. It was originally a direct R2 custom domain with no counter;
  see `../../grimoire-apt/README.md` for that Worker and its one-time cutover.
- Publishing: the `apt-publish` job in `.github/workflows/release.yml` runs on
  each tagged release. It rebuilds a fresh, GPG-signed, **latest-only** repo
  from that release's `.deb` with `reprepro`, then syncs it to R2.
- Source of truth for old versions stays GitHub Releases. The apt repo only ever
  offers the newest version (which is what `apt upgrade` wants).
- Scope: `amd64` only. Arch users use the AUR (`grimoire-bin`).

The job is gated on the repo variable `APT_PUBLISH_ENABLED == 'true'`, so it is
skipped (and releases stay green) until the one-time setup below is complete.

## One-time setup

### 1. Enable R2, then create the bucket + custom domain

R2 is a one-time, free per-account toggle and is not enabled yet: Cloudflare
dashboard > R2 > enable. Then:

```bash
wrangler r2 bucket create grimoire-apt
```

Then in the Cloudflare dashboard: **R2 > grimoire-apt > Settings > Custom Domains**
and add `apt.grimoiremods.com`. The DNS record is created automatically because
the zone is already on Cloudflare.

### 2. R2 API token

**R2 > Manage API Tokens > Create** an **Object Read & Write** token scoped to
the `grimoire-apt` bucket. Record the Access Key ID, the Secret Access Key, and
your Cloudflare Account ID (the S3 endpoint is
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

### 3. Signing key

Generate a dedicated, passphraseless RSA-4096 key (passphraseless because it runs
unattended in CI; it lives only as an encrypted GitHub secret). RSA-4096 is used
over ed25519 for the widest apt compatibility.

```bash
gpg --batch --gen-key <<'EOF'
%no-protection
Key-Type: RSA
Key-Length: 4096
Name-Real: Grimoire APT
Name-Email: slusheliott@gmail.com
Expire-Date: 0
EOF

# Value for the APT_GPG_PRIVATE_KEY secret:
gpg --export-secret-keys --armor "Grimoire APT" | base64 -w0
```

### 4. GitHub secrets and variable

Repo **Settings > Secrets and variables > Actions**.

Secrets:

| Name | Value |
|---|---|
| `APT_GPG_PRIVATE_KEY` | the base64 blob from step 3 |
| `R2_ACCESS_KEY_ID` | R2 token Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 token Secret Access Key |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |

Variable (this is what turns the job on):

| Name | Value |
|---|---|
| `APT_PUBLISH_ENABLED` | `true` |

### 5. Publish

Cut a release as usual (push a `v*` tag). The `apt-publish` job populates the
bucket. To backfill without a new version, re-run the latest release's workflow.

## User install instructions

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://apt.grimoiremods.com/grimoire.gpg \
  | sudo tee /etc/apt/keyrings/grimoire.gpg >/dev/null
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/grimoire.gpg] https://apt.grimoiremods.com stable main" \
  | sudo tee /etc/apt/sources.list.d/grimoire.list >/dev/null
sudo apt update
sudo apt install grimoire
```

Updates thereafter come through `sudo apt update && sudo apt upgrade`.

Verified clean dependency resolution on Ubuntu 22.04, Ubuntu 24.04, and Debian 12.

## Notes

- Storage stays at roughly one deb (~170 MB). The publish job rebuilds a fresh
  latest-only repo each release and syncs with `--delete`, so the previous
  version's deb is pruned from the bucket instead of accumulating. You stay far
  under R2's 10 GB free tier no matter how many releases ship. Older versions
  remain available on GitHub Releases.
- The `dists/` index is uploaded with `Cache-Control: no-cache` and the `pool/`
  debs with a long immutable max-age. This prevents Cloudflare's CDN from serving
  a stale package index after a release while still caching the (immutable,
  version-stamped) debs at the edge.
- Key rotation: generate a new key, update `APT_GPG_PRIVATE_KEY`, and re-run a
  release. The new public key publishes to `grimoire.gpg` automatically; existing
  users would need to re-fetch the key, so rotate only when necessary.
