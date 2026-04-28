<div align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Grimoire">
  <h1>Grimoire</h1>
  <p>A mod manager for Deadlock.</p>

  [![Release](https://img.shields.io/github/v/release/Slush97/grimoire?style=flat-square)](../../releases/latest)
  ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-333?style=flat-square)
  ![License](https://img.shields.io/github/license/Slush97/grimoire?style=flat-square)
</div>

## Download

[Latest release →](../../releases/latest)

- Windows: `Grimoire-Setup-x.y.z.exe`
- Linux: `.AppImage` or `.deb`

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
