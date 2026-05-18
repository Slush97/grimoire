# Hero sound codenames

Reference dictionary for mapping Deadlock's internal hero codenames to display names, scoped to **sound-mods-in-Locker** work (organize sound mods by hero and ability slot).

## Why two columns of codenames

Deadlock uses **two parallel codename namespaces** that don't always agree:

1. **`class_name`** (form: `hero_<name>`) — what `assets.deadlock-api.com/v2/heroes` returns. Used by HUD, panorama, scripts.
2. **sound-path codename** — what the VPK actually uses inside `sounds/abilities/<codename>/a<1-4>_<ability>/`.

For 33 of the 35 heroes that currently ship ability sounds, these two agree. The exceptions:

| Display name | Sound-path codename | `class_name` |
|---|---|---|
| Abrams | `abrams` | `hero_atlas` |
| Mo & Krill | `mokrill` | `hero_krill` |

When matching a mod's VPK contents, use the **sound-path** column. When talking to deadlock-api or reading scripts, use **`class_name`**.

## Ability slot convention

```
sounds/abilities/<sound_codename>/a<N>_<ability_internal_name>/...
```

- `a1` / `a2` / `a3` are the three base abilities (1/2/3 in UI).
- `a4` is the ultimate.
- `<ability_internal_name>` is descriptive (e.g. `a2_charge` for Abrams Shoulder Charge, `a4_leap` for his ult).

A single sound mod's VPK can touch multiple `(hero, slot)` tuples (multi-ability replacement packs). Surface every tuple it modifies; don't pick one.

### Caveat: rework leftovers

Some heroes have multiple `a<N>_*` entries at the same slot because Valve kept old ability dirs after a rework. Mirage is the worst case:

```
mirage  a2  sand_phantom
mirage  a2  tornado
mirage  a3  bullet_burst
mirage  a3  djinns_mark
mirage  a4  dreamweaver
mirage  a4  sunfire_cataclysm
mirage  a4  teleport
mirage  a4  whirling_dervish
```

Treat alternates at the same slot as aliases of that slot, not separate abilities. The currently-shipped ability name for each Mirage slot is the live one; the rest are dead paths that mods may still target. Surfacing them as the same slot keeps mods grouped sensibly.

Other heroes with similar leftover entries (smaller scale): `tengu a1` (`ghost`, `stone_squall`), `wrecker a2` (`salvage`, `scrap_blast`), `wrecker a4` (`teleport`, `wrecking_crew`), `synth a2` (`flying_cloak`, `grasp`), `tokamak a3` (`breach`, `radiance`), `nano a4` (`bomb`, `tower`).

## Coverage

deadlock-api lists 61 heroes total (live + in-development + disabled). The core VPK currently ships ability sound directories for **35** of them. In-dev / disabled heroes that already have sound assets:

- Fathom (`hero_slork`), Tokamak (`hero_tokamak`), Trapper (`hero_trapper`), Wrecker (`hero_wrecker`), Kali (`hero_kali`)

UI rule (per product call): **hide heroes whose API record has `disabled: true` until Valve flips them on.** Don't show in the Locker hero list even if their sound dir exists.

## Full dictionary (35 heroes with shipped ability sounds)

Sorted by sound-path codename. Hidden-in-UI rows marked `[hide]`.

| Sound codename | Display | `class_name` | API id | Notes |
|---|---|---|---|---|
| `abrams` | Abrams | `hero_atlas` | 6 | codename mismatch |
| `astro` | Holliday | `hero_astro` | 14 | |
| `bebop` | Bebop | `hero_bebop` | 15 | |
| `bookworm` | Paige | `hero_bookworm` | 67 | |
| `chrono` | Paradox | `hero_chrono` | 10 | |
| `drifter` | Drifter | `hero_drifter` | 64 | |
| `dynamo` | Dynamo | `hero_dynamo` | 11 | |
| `fathom` | Fathom | `hero_slork` | 53 | `[hide]` in-dev |
| `fencer` | Apollo | `hero_fencer` | 77 | |
| `forge` | McGinnis | `hero_forge` | 8 | |
| `ghost` | Lady Geist | `hero_ghost` | 4 | |
| `gigawatt` | Seven | `hero_gigawatt` | 2 | |
| `haze` | Haze | `hero_haze` | 13 | |
| `hornet` | Vindicta | `hero_hornet` | 3 | |
| `inferno` | Infernus | `hero_inferno` | 1 | |
| `kali` | Kali | `hero_kali` | 21 | `[hide]` disabled |
| `kelvin` | Kelvin | `hero_kelvin` | 12 | |
| `lash` | Lash | `hero_lash` | 31 | |
| `mirage` | Mirage | `hero_mirage` | 52 | rework leftovers (see caveat) |
| `mokrill` | Mo & Krill | `hero_krill` | 18 | codename mismatch |
| `nano` | Calico | `hero_nano` | 16 | |
| `orion` | Grey Talon | `hero_orion` | 17 | |
| `punkgoat` | Billy | `hero_punkgoat` | 72 | |
| `shiv` | Shiv | `hero_shiv` | 19 | |
| `synth` | Pocket | `hero_synth` | 50 | |
| `tengu` | Ivy | `hero_tengu` | 20 | |
| `tokamak` | Tokamak | `hero_tokamak` | 47 | `[hide]` in-dev |
| `trapper` | Trapper | `hero_trapper` | 61 | `[hide]` in-dev |
| `unicorn` | Celeste | `hero_unicorn` | 81 | |
| `vampirebat` | Mina | `hero_vampirebat` | 63 | |
| `viper` | Vyper | `hero_viper` | 58 | |
| `viscous` | Viscous | `hero_viscous` | 35 | |
| `werewolf` | Silver | `hero_werewolf` | 80 | |
| `wrecker` | Wrecker | `hero_wrecker` | 48 | `[hide]` disabled |
| `yamato` | Yamato | `hero_yamato` | 27 | |

## How to refresh

Plan of record (not yet implemented): a build-time script generates `electron/main/services/heroSoundCodenames.json` from `https://assets.deadlock-api.com/v2/heroes`. Sound-path codenames are scraped from the live `game/citadel/pak01_dir.vpk` (Deadlock core) using its directory tree; the two-namespace mismatches above are baked in as overrides for any case where the API's `class_name` differs from the live sound path.

Until the script lands, this table is the source of truth. To re-verify by hand:

```bash
# 1) Pull current hero list
curl -sS https://assets.deadlock-api.com/v2/heroes > /tmp/heroes.json

# 2) Extract live sound-path codenames from the installed game
strings -n 6 \
  ~/.steam/steam/steamapps/common/Deadlock/game/citadel/pak01_dir.vpk \
  | grep -ioE '^sounds/abilities/[a-z0-9_]+/' \
  | sed -E 's|^sounds/abilities/([^/]+)/$|\1|' \
  | sort -u
```

If a new hero shows up in step 2 that isn't in step 1, or if a sound-path codename diverges from a known `class_name`, add a row above and an override entry to the generator script.

## Source

- deadlock-api.com `/v2/heroes`: authoritative for hero roster, `class_name`, `disabled`, `in_development`.
- Deadlock core VPK (`game/citadel/pak01_dir.vpk`) directory tree: authoritative for sound-path codenames and ability slot names.
- Cross-referenced 2026-05-17 against a live Deadlock install. deadlock-api is community-run and not endorsed by Valve; the VPK is the ground truth if the two ever disagree.
