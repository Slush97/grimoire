# GameBanana Categories Reference for Deadlock

> **Game ID**: `20948` (Deadlock)
> **Last Verified**: 2024-12-31
> **Total Items Scanned**: 1,579

---

## Overview

GameBanana uses a **flat category system** for Deadlock. There are NO sub-categories or hierarchical structures. 

> [!CAUTION]
> **There are NO hero-specific categories.**
> 
> You will NOT find categories like \"Abrams Skins\" or \"Yamato Mods\". ALL hero content is dumped into generic buckets like \"Skins\" (33295) or \"Model Replacement\" (33154).
> 
> **To filter by hero, you MUST use:**
> 1. The Search API with the hero name
> 2. Client-side tag/title parsing after fetching

### Category Types
Categories are typed based on their parent submission type:

| Category Type | API Item Type | URL Pattern | Used For |
| :--- | :--- | :--- | :--- |
| **ModCategory** | `ModCategory` | `/mods/cats/{id}` | Visual mods, gameplay, HUD |
| **SoundCategory** | `SoundCategory` | `/sounds/cats/{id}` | Audio, music, sound effects |
| **ToolCategory** | `ToolCategory` | `/tools/cats/{id}` | Modding utilities |
| **TutorialCategory** | `TutorialCategory` | `/tuts/cats/{id}` | How-to guides |

---

## Complete Category Listing

### ModCategory (Visual Mods)

| ID | Name | Count | Description | Profile URL |
| ---: | :--- | ---: | :--- | :--- |
| `33295` | **Skins** | 454 | Primary hero skins category. Most character model replacements. | `gamebanana.com/mods/cats/33295` |
| `33154` | **Model Replacement** | 95 | Full model swaps (not just textures). | `gamebanana.com/mods/cats/33154` |
| `31713` | **HUD** | 98 | UI modifications, reticles, crosshairs, health bars. | `gamebanana.com/mods/cats/31713` |
| `31710` | **Other/Misc** | 71 | Generic mods that don't fit other categories. | `gamebanana.com/mods/cats/31710` |
| `3366` | **Other/Misc** | 57 | Legacy miscellaneous category (shared across games). | `gamebanana.com/mods/cats/3366` |
| `3807` | **Skins** | 41 | Secondary skins category (legacy/shared). | `gamebanana.com/mods/cats/3807` |
| `2114` | **Other/Misc** | 22 | Legacy misc category. | `gamebanana.com/mods/cats/2114` |
| `33331` | **Gameplay Modifications** | 6 | Scripts affecting gameplay mechanics. | `gamebanana.com/mods/cats/33331` |
| `37225` | **Maps** | 4 | Level/map modifications. | `gamebanana.com/mods/cats/37225` |
| `2957` | **Other/Misc** | 2 | Legacy misc. | `gamebanana.com/mods/cats/2957` |
| `3616` | **Other/Misc** | 2 | Legacy misc. | `gamebanana.com/mods/cats/3616` |
| `2855` | **Maps** | 1 | Secondary maps category (legacy). | `gamebanana.com/mods/cats/2855` |
| `804` | **Other/Misc** | 1 | Very old legacy category. | `gamebanana.com/mods/cats/804` |
| `1922` | **Other/Misc** | 1 | Legacy misc. | `gamebanana.com/mods/cats/1922` |

**ModCategory Subtotal**: 855 items

---

### SoundCategory (Audio)

| ID | Name | Count | Description | Profile URL |
| ---: | :--- | ---: | :--- | :--- |
| `5815` | **Other/Misc** | 468 | **LARGEST CATEGORY**. Generic audio files, voice lines, misc SFX. | `gamebanana.com/sounds/cats/5815` |
| `5842` | **Music** | 226 | Background music replacements, menu themes. | `gamebanana.com/sounds/cats/5842` |
| `5843` | **Killsounds** | 14 | Audio that plays on kill. | `gamebanana.com/sounds/cats/5843` |
| `5895` | **Killstreak Music** | 9 | Audio that plays during killstreaks. | `gamebanana.com/sounds/cats/5895` |
| `5546` | **Other/Misc** | 3 | Legacy misc audio. | `gamebanana.com/sounds/cats/5546` |
| `5262` | **Other/Misc** | 1 | Legacy misc audio. | `gamebanana.com/sounds/cats/5262` |

**SoundCategory Subtotal**: 721 items

---

### ToolCategory (Utilities)

| ID | Name | Count | Description | Profile URL |
| ---: | :--- | ---: | :--- | :--- |
| `1932` | **Modding** | 3 | Modding tools, extractors, packers. | `gamebanana.com/tools/cats/1932` |

**ToolCategory Subtotal**: 3 items

---

## Category ID Quick Reference

For easy copy-paste into code:

```javascript
const DEADLOCK_CATEGORIES = {
  // ModCategory (Visuals)
  SKINS_PRIMARY: 33295,
  SKINS_LEGACY: 3807,
  MODEL_REPLACEMENT: 33154,
  HUD: 31713,
  GAMEPLAY_MODS: 33331,
  MAPS_PRIMARY: 37225,
  MAPS_LEGACY: 2855,
  MOD_MISC_1: 31710,
  MOD_MISC_2: 3366,
  MOD_MISC_3: 2114,
  MOD_MISC_4: 2957,
  MOD_MISC_5: 3616,
  MOD_MISC_6: 804,
  MOD_MISC_7: 1922,
  
  // SoundCategory (Audio)
  SOUND_MISC: 5815,  // LARGEST - 468 items
  MUSIC: 5842,
  KILLSOUNDS: 5843,
  KILLSTREAK_MUSIC: 5895,
  SOUND_MISC_2: 5546,
  SOUND_MISC_3: 5262,
  
  // ToolCategory
  MODDING_TOOLS: 1932,
};

// Groupings for UI
const VISUAL_CATEGORIES = [33295, 3807, 33154, 31713, 33331, 37225, 2855, 31710, 3366, 2114, 2957, 3616, 804, 1922];
const AUDIO_CATEGORIES = [5815, 5842, 5843, 5895, 5546, 5262];
const TOOL_CATEGORIES = [1932];
```

---

## Understanding "Other/Misc" Duplicates

GameBanana has **multiple categories with the same display name** ("Other/Misc") but different IDs. This is because:

1. **Legacy Categories**: Old categories from before Deadlock was added, shared across multiple games.
2. **Type-Specific**: Each item type (Mod, Sound) has its own "Other/Misc" bucket.
3. **Game-Specific vs Global**: Some IDs are Deadlock-specific (e.g., `31710`), others are global (e.g., `3366`).

### Disambiguation Table

| ID | Item Type | Specificity | Recommended Use |
| ---: | :--- | :--- | :--- |
| `31710` | Mod | Deadlock-Specific | Primary "Misc Mods" bucket |
| `3366` | Mod | Global (Legacy) | Fallback misc mods |
| `2114` | Mod | Global (Legacy) | Rare/old content |
| `5815` | Sound | Deadlock-Specific | Primary "Misc Audio" bucket |
| `5546` | Sound | Global (Legacy) | Rare audio |

---

## Hero Identification

Deadlock does **NOT** use sub-categories for heroes. Instead, hero-specific mods are tagged.

### Tag Extraction
Parse the `_aTags` array from mod records:

```javascript
// Example tag structures seen in API responses:
"_aTags": ["character: lash", "deadlock", "skin"]
"_aTags": ["yamato", "ult: replacement"]
"_aTags": ["mo & krill", "sound"]
```

### Known Hero Tags (All 32 Heroes)

| Hero | Tag Variations |
| :--- | :--- |
| **Abrams** | `abrams` |
| **Bebop** | `bebop`, `bebop: beam` |
| **Billy** | `billy` |
| **Calico** | `calico` |
| **Doorman** | `doorman`, `the doorman` |
| **Drifter** | `drifter`, `character: drifter` |
| **Dynamo** | `dynamo` |
| **Grey Talon** | `grey talon`, `greytalon`, `gray talon` |
| **Haze** | `haze` |
| **Holliday** | `holliday` |
| **Infernus** | `infernus` |
| **Ivy** | `ivy`, `deadlock skin: ivy` |
| **Kelvin** | `kelvin` |
| **Lady Geist** | `geist`, `lady geist` |
| **Lash** | `lash`, `character: lash` |
| **McGinnis** | `mcginnis`, `mcginnis: 1` |
| **Mina** | `mina` |
| **Mirage** | `mirage` |
| **Mo & Krill** | `mo & krill`, `mo and krill`, `mo&krill`, `hero: mo & krill` |
| **Paige** | `paige` |
| **Paradox** | `paradox` |
| **Pocket** | `pocket`, `memes: pocket` |
| **Seven** | `seven` |
| **Shiv** | `shiv` |
| **Sinclair** | `sinclair`, `the magnificent sinclair` |
| **Victor** | `victor` |
| **Vindicta** | `vindicta` |
| **Viscous** | `viscous` |
| **Vyper** | `vyper` |
| **Warden** | `warden` |
| **Wraith** | `wraith` |
| **Yamato** | `yamato`, `yamato: ult`, `dragon install: yamato` |

### Implementation: Hero Filter

```javascript
const HERO_TAGS = {
  // All 32 Deadlock heroes
  'abrams': 'Abrams',
  'bebop': 'Bebop',
  'billy': 'Billy',
  'calico': 'Calico',
  'doorman': 'Doorman',
  'the doorman': 'Doorman',
  'drifter': 'Drifter',
  'dynamo': 'Dynamo',
  'grey talon': 'Grey Talon',
  'greytalon': 'Grey Talon',
  'gray talon': 'Grey Talon',
  'haze': 'Haze',
  'holliday': 'Holliday',
  'infernus': 'Infernus',
  'ivy': 'Ivy',
  'kelvin': 'Kelvin',
  'geist': 'Lady Geist',
  'lady geist': 'Lady Geist',
  'lash': 'Lash',
  'mcginnis': 'McGinnis',
  'mina': 'Mina',
  'mirage': 'Mirage',
  'mo & krill': 'Mo & Krill',
  'mo and krill': 'Mo & Krill',
  'mo&krill': 'Mo & Krill',
  'paige': 'Paige',
  'paradox': 'Paradox',
  'pocket': 'Pocket',
  'seven': 'Seven',
  'shiv': 'Shiv',
  'sinclair': 'Sinclair',
  'the magnificent sinclair': 'Sinclair',
  'victor': 'Victor',
  'vindicta': 'Vindicta',
  'viscous': 'Viscous',
  'vyper': 'Vyper',
  'warden': 'Warden',
  'wraith': 'Wraith',
  'yamato': 'Yamato',
};

function extractHeroes(tags) {
  const heroes = new Set();
  for (const tag of tags) {
    const normalized = tag.toLowerCase().replace('character: ', '').replace('hero: ', '');
    if (HERO_TAGS[normalized]) {
      heroes.add(HERO_TAGS[normalized]);
    }
  }
  return Array.from(heroes);
}
```

---

## API Verification

Each category ID can be verified via the Core API:

```http
GET https://api.gamebanana.com/Core/Item/Data?itemtype=ModCategory&itemid=33295&fields=name,Game().name
Response: ["Skins", "Deadlock"]

GET https://api.gamebanana.com/Core/Item/Data?itemtype=SoundCategory&itemid=5815&fields=name,Game().name
Response: ["Other/Misc", "Deadlock"]
```

---

## Summary Statistics

| Metric | Value |
| :--- | ---: |
| **Total Submissions** | 1,579 |
| **Unique Root Categories** | 21 |
| **ModCategory IDs** | 14 |
| **SoundCategory IDs** | 6 |
| **ToolCategory IDs** | 1 |
| **Unique Tags** | 131 |
| **Identified Heroes** | 32 |
