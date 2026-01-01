# Deadlock Mod Manager

A modern mod manager for **Deadlock** (Valve's Source 2 game). Browse GameBanana, manage VPK mods, customize crosshairs, and organize your setup with profiles.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)

## Features

- 🎮 **Browse & Download** — Search GameBanana mods with local caching
- 📦 **Mod Management** — Enable/disable mods, set priorities, resolve conflicts
- 🎯 **Crosshair Designer** — Create custom crosshairs with live preview
- 🦸 **Hero Locker** — View and organize skins by hero
- 📝 **Autoexec Manager** — Configure console commands
- 💾 **Profiles** — Save and restore mod configurations

## Installation

### Pre-built Releases
Download from [Releases](../../releases) for your platform:
- **Windows**: `.exe` installer or portable
- **Linux**: `.AppImage` or `.deb`
- **macOS**: `.dmg`

### Build from Source
```bash
# Clone and install
git clone https://github.com/yourusername/deadlock-mod-manager.git
cd deadlock-mod-manager
pnpm install

# Development
pnpm dev

# Build for your platform
pnpm package:linux  # or package:win, package:mac
```

## Usage

1. Launch and set your Deadlock installation path (auto-detected on most systems)
2. Browse mods from GameBanana or manage installed VPKs
3. Enable/disable mods with a single click
4. Use Profiles to save different mod configurations

## Requirements

- Deadlock installed via Steam
- 7-Zip installed for extracting `.7z` archives (Linux/macOS)

## License

[MIT](LICENSE)
