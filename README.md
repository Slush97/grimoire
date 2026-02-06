<div align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Grimoire">
  <h1>Grimoire</h1>
  <p>Mod manager for Deadlock</p>
  
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/Slush97/grimoire?style=flat-square" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-333?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/github/license/Slush97/grimoire?style=flat-square" alt="License">
</div>

<br>

## Features

- **Browse & Install** — Search GameBanana and install mods with one click
- **Mod Management** — Enable, disable, reorder priority, detect conflicts
- **Hero Locker** — Organize skins by character
- **Crosshair Editor** — Design crosshairs with live preview
- **Autoexec Manager** — Configure console commands without editing files
- **Profiles** — Save and switch between mod configurations

## Download

Get the latest release for your platform:

| Platform | Download |
|----------|----------|
| Windows | [Installer (.exe)](../../releases/latest) |
| Linux | [AppImage](../../releases/latest), [.deb](../../releases/latest) |

**Requirements:** Deadlock installed via Steam

## Development

```bash
git clone https://github.com/Slush97/grimoire.git
cd grimoire
pnpm install
pnpm exec electron-rebuild -f -w better-sqlite3
pnpm dev
```

Build: `pnpm package:linux` or `pnpm package:win`

## License

MIT
