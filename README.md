<div align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Grimoire">
  <h1>Grimoire</h1>
  <p>A mod manager for Deadlock.</p>

  [![Website](https://img.shields.io/badge/grimoiremods.com-f97316)](https://grimoiremods.com)
  [![Release](https://img.shields.io/github/v/release/Slush97/grimoire?label=release)](../../releases/latest)
  [![AUR](https://img.shields.io/aur/version/grimoire-bin?label=aur)](https://aur.archlinux.org/packages/grimoire-bin)
  [![CI](https://img.shields.io/github/actions/workflow/status/Slush97/grimoire/ci.yml?branch=main&label=ci)](../../actions/workflows/ci.yml)
  [![GameBanana](https://img.shields.io/badge/GameBanana-FCDC2A)](https://gamebanana.com/tools/22583)
  [![Discord](https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/KgYGHEMq2P)
  [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
</div>

## Install

[Latest release →](../../releases/latest)

- Windows: `Grimoire-Setup-x.y.z.exe`
- Linux: `.AppImage` or `.deb`
- Arch Linux: `yay -S grimoire-bin` ([AUR](https://aur.archlinux.org/packages/grimoire-bin))

### Debian / Ubuntu (apt)

Install and stay updated through apt:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://apt.grimoiremods.com/grimoire.gpg | sudo tee /etc/apt/keyrings/grimoire.gpg >/dev/null
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/grimoire.gpg] https://apt.grimoiremods.com stable main" | sudo tee /etc/apt/sources.list.d/grimoire.list >/dev/null
sudo apt update && sudo apt install grimoire
```

Afterwards `sudo apt upgrade` keeps it current. More detail: [docs/apt-repo.md](docs/apt-repo.md).

Requires Deadlock installed via Steam.

## Features

- Browse and install mods from GameBanana
- Enable, disable, reorder, and detect conflicts
- Per-hero skin locker
- Autoexec manager
- Profiles for saving and swapping mod configurations

Experimental:

- Crosshair editor with live preview

## Screenshots

![Installed mods](docs/screenshots/installed.png)
![Browse GameBanana](docs/screenshots/browse.png)
![Hero Locker](docs/screenshots/locker.png)

## Development

```bash
git clone https://github.com/Slush97/grimoire.git
cd grimoire
pnpm install
pnpm exec electron-rebuild -f -w better-sqlite3
pnpm dev
```

Package builds: `pnpm package:win` or `pnpm package:linux`.

## Security

Grimoire is open source. Users are encouraged to read the code, build
from source, or audit any release artifact themselves before running
it. Reports of security or trust concerns are welcome via
[Issues](../../issues).

Each release ships a `SHA256SUMS` file listing the hash of every
installer. Verify a download with `sha256sum -c SHA256SUMS` (Linux) or
`Get-FileHash <file>` (PowerShell) and compare against the listing.
Releases also publish [build provenance attestations](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds)
that tie each artifact back to the exact commit and workflow run that
produced it; verify with `gh attestation verify <file> --owner Slush97`.

Windows installers are not yet code-signed, so SmartScreen will show an
"Unknown Publisher" warning on first run — click **More info → Run
anyway** to proceed. Free Authenticode signing through the SignPath
Foundation OSS program is being pursued.

## License

MIT
