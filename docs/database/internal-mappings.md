# Internal Metadata Mappings

To provide a user-friendly interface for stats data, the manager maintains internal registries to map raw API IDs to display names.

## Hero Name Mapping (`HERO_NAMES`)

Source: `src/types/deadlock-stats.ts`

This mapping translates the `hero_id` returned by the Deadlock API into the character's canonical name.

| 1 | Infernus | 18 | Shiv |
| 2 | Seven | 19 | Ivy |
| 3 | Vindicta | 20 | Warden |
| 4 | Lady Geist | 25 | Yamato |
| 6 | Abrams | 27 | Lash |
| 7 | Wraith | 31 | Viscous |
| 8 | McGinnis | 35 | Pocket |
| 10 | Paradox | 50 | Mirage |
| 11 | Dynamo | 55 | Calico |
| 12 | Kelvin | 58 | Sinclair |
| 13 | Haze | 59 | Billy |
| 14 | Holliday | 60 | Mina |
| 15 | Bebop | 61 | Drifter |
| 16 | Grey Talon | 62 | Paige |
| 17 | Mo & Krill | 63 | Victor |
| 64 | Doorman | 67 | Vyper |

### Maintenance Note
As Valve adds new heroes or changes internal IDs, this mapping must be updated manually in `src/types/deadlock-stats.ts`. Note that IDs for unreleased/experimental heroes (IDs > 50) may fluctuate between API versions or "Hero Labs" updates. There is currently a discrepancy between this 36+ hero roster and the 32 heroes mapped in the Locker's `HERO_FACE_POSITION`.

---

## Roster Reconciliation (2026-01)

The Deadlock Mod Manager tracks a growing roster of 36+ heroes. Due to the rapid development of "Hero Labs" and experimental characters, there is a discrepancy between the Stats dashboard and the Hero Locker.

| System | Hero Count | Status |
| :--- | :--- | :--- |
| **Stats (`HERO_NAMES`)** | 36+ | Most inclusive; includes unreleased and experimental IDs. |
| **Locker (`HERO_FACE_POSITION`)** | 32 | Lacks recent experimental additions. |

### Experimental Hero Management

Specifically for the Meta analytics (Counters, Synergies, Duos), the application utilizes a central `EXPERIMENTAL_HERO_IDS` constant to filter out unreliable data.

| ID | Name | Management Strategy |
| :--- | :--- | :--- |
| 52 | Wrecker | Excluded from `HERO_NAMES` and UI filters. |
| 66 | Fathom | Excluded from `HERO_NAMES` and UI filters. |
| 68 | Trapper | Excluded from `HERO_NAMES` and UI filters. |
| 69 | Raven | Excluded from `HERO_NAMES` and UI filters. |
| 72 | The Warden | Excluded from `HERO_NAMES` and UI filters. |

### Resolution Logic

1. **Stats Mapping Fallback**: When rendering a hero name for an ID not in `HERO_NAMES`, the UI falls back to `Hero {id}`.
2. **Experimental Filtering**: The `Heroes`, `Analytics`, and `Meta` tabs (Duos, Counters, Synergies) explicitly filter out any combinations or entries containing IDs found in the `EXPERIMENTAL_HERO_IDS` set to maintain a clean and reliable roster.
3. **Author Fallback**: In the Build Browser, missing author names are replaced with `Author ID {id}` or `Unknown Author`.
4. **Locker Sync**: New heroes added to GameBanana categories are discovered automatically. Portrait X-positioning for these characters must be manually added to `HERO_FACE_POSITION` in `lockerUtils.ts` to ensure correct cropping in the Hero Gallery.

---

## Rank Name Mapping

The Deadlock API returns a numeric `badge_level` for rank distribution. The application parses these IDs using a `floor(level / 10)` group index and `level % 10` sub-tier index.

| Group Index | Level Range | Tier Name | Theme Color |
|:---:|:---|:---|:---|
| 1 | 11 - 16 | **Initiate** | `#9CA3AF` (Silver) |
| 2 | 21 - 26 | **Seeker** | `#A16207` (Bronze) |
| 3 | 31 - 36 | **Alchemist** | `#FBBF24` (Gold) |
| 4 | 41 - 46 | **Arcanist** | `#22C55E` (Green) |
| 5 | 51 - 56 | **Ritualist** | `#06B6D4` (Cyan) |
| 6 | 61 - 66 | **Emissary** | `#3B82F6` (Blue) |
| 7 | 71 - 76 | **Archon** | `#8B5CF6` (Purple) |
| 8 | 81 - 86 | **Oracle** | `#EC4899` (Pink) |
| 9 | 91 - 96 | **Phantom** | `#EF4444` (Red) |
| 10 | 101 - 106 | **Ascendant** | `#F97316` (Orange) |
| 11 | 111 - 116 | **Eternus** | `#FBBF24` (Gold/Legendary) |

### Obscurus (Unranked)
Players who have not completed their weekly placement matches or are in a provisional state are labeled as **Obscurus**. In the API, this typically corresponds to a level of 0 (or simply a missing `badge_level`). Established rank groups (1-11) begin at badge level 12.


### Implementation Detail
Rank names are resolved as `{GroupName} {RomanNumeral}` where the Roman numeral corresponds to the `level % 10` value (sublevels 2-6 map into I-V). This mapping is handled in `electron/main/services/stats.ts` via the `rankGroups` record and a `romanMap` in the `getRankInfo` helper function.

