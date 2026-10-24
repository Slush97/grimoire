# GameBanana Categories Reference for Deadlock

> **Game ID**: `20948` (Deadlock)
> **Last Verified**: 2026-10-24, against the live `Util/{Model}/NestedStructure` endpoints and the app's cached trees (`category_cache` in `mods-cache.db`). Item counts are `_nItemCount` from the cached trees (fetched 2026-10-16 to 2026-10-24) and drift daily.

---

## Overview

GameBanana's Deadlock categories are a **tree**, not a flat list. Each submission type has its own category model, and a category id is only unique within its model: "Other/Misc" exists in Mod, Sound, Wip and Tool, and `2855` is Maps in WipCategory.

| Item type | Category model | URL pattern | Fetched by the app |
| :--- | :--- | :--- | :--- |
| `Mod` | `ModCategory` | `/mods/cats/{id}` | yes |
| `Sound` | `SoundCategory` | `/sounds/cats/{id}` | yes |
| `Wip` | `WipCategory` | `/wips/cats/{id}` | yes |
| `Tool` | `ToolCategory` | `/tools/cats/{id}` | no |

`GET /Game/20948/CategoryTree` lists every section and its category model. The tree itself comes from:

```http
GET https://gamebanana.com/apiv11/Util/ModCategory/NestedStructure?_idGameRow=20948
```

Each node has `_idRow`, `_sName`, `_sProfileUrl`, `_nItemCount`, `_sIconUrl`, `_idParentRow` (children only) and `_aChildren` (when it has any). The app reads these through `fetchCategoryTreeCached` (`electron/main/services/gamebanana.ts`), refreshes a cached tree after a day, and stores it in `category_cache`.

### Ids on submissions

- **List endpoints** (`/{Model}/Index`, `/Util/Search/Results`): `_aRootCategory` is the tree root and carries only `_sName`, `_sProfileUrl` and `_sIconUrl`, **no `_idRow`**. `_aSubCategory` has the same shape and is the submission's own category when that is not the root (a hero, or a nested child such as Faithful/Vanilla+); it is `null` for a submission filed directly under its root. The id exists only inside the URL (`.../mods/cats/{id}`); see `categoryIdFromProfileUrl` in `src/lib/heroFilter.ts`.
- **Detail endpoint** (`/{Model}/{id}`): `_aCategory` is the submission's own category with `_idRow` (for a hero skin, the hero or its nested child, not the Skins root).
- **Local catalog** (`mods` table): `category_id` is NULL on every row, `category_name` is the root name, and `sub_category_id` is the real subcategory id (set on 4,437 of 5,427 Mod rows and 60 of 4,676 Sound rows in the 2026-10-24 mirror, none of the Wip rows). See the comments in `electron/main/services/searchService.ts` and `modDatabase.ts`.
- The category filter `_aFilters[Generic_Category]` is relied on to include descendants (`categorySubtreeIds` in `src/lib/heroFilter.ts`).

---

## ModCategory

Eight roots. Hero skins are subcategories of Skins; Sound and Wip have no hero categories.

| ID | Name | Items | Children |
| ---: | :--- | ---: | :--- |
| `33295` | **Skins** | 3478 | 44 heroes, see below |
| `31713` | **HUD** | 722 | Character HUD `44745`, Cursors `49794`, Gameplay `44748`, Items HUD `44746` |
| `33154` | **Model Replacement** | 575 | Active Items `44699`, Breakables `41651`, Hideout `44206`, NPCs `44691`, Rejuvenator `45979`, Sinner's Sacrifice `44391`, Soul Container `41868`, Spirit Urn `41656` |
| `46154` | **Quality of Life/Fixes** | 155 | Accessibility `44749` |
| `31710` | **Other/Misc** | 140 | none |
| `33331` | **Gameplay Modifications** | 31 | none |
| `37225` | **Maps** | 41 | none |
| `47611` | **Animations** | 23 | none |

Model Replacement > NPCs has seven children of its own: Guardian `44688`, Haunts `44690`, Midboss `44686`, Patrons `45181`, Sandbox Dummy `46849`, Troopers `44687`, Walker `44458`. The deepest paths are three levels, root included (Model Replacement > NPCs > Troopers, Skins > hero > Faithful/Vanilla+).

### Skins: heroes

44 hero categories sit directly under Skins (`33295`). Every hero has a "Faithful/Vanilla+" child. Rat King also has `RatKing Flag` (`49852`).

Eight heroes carry a misspelled child, **"Faithul/Vanilla+"**: Abrams, Venator, Victor, Vindicta, Vyper, Warden, Wraith, Yamato. The other 36 spell it "Faithful/Vanilla+". Match on id, never on the child's name.

A submission filed in a child records the child as its category, so neither its category id nor its category name identifies the hero. Resolve the hero by walking the tree (`buildHeroByCategoryId` in `src/lib/lockerUtils.ts`, `heroCategoryStore`). Rat King's category is named `Rat King` in the current tree; `canonicalHeroName` still maps the older `RatKing` spelling.

| Hero | Category id | Child ids |
| :--- | ---: | :--- |
| Abrams | `33306` | `50565` |
| Apollo | `42673` | `50629` |
| Baba | `49632` | `50628` |
| Bebop | `33307` | `50627` |
| Billy | `41491` | `50626` |
| Calico | `41649` | `50625` |
| Celeste | `42672` | `50624` |
| Deadman Danny | `49630` | `50623` |
| Doorman | `40060` | `50622` |
| Drifter | `41492` | `50621` |
| Dynamo | `33308` | `50620` |
| Graves | `42674` | `50619` |
| Grey Talon | `33310` | `50618` |
| Haze | `33311` | `50617` |
| Holliday | `36472` | `50616` |
| Infernus | `33312` | `50615` |
| Ivy | `33313` | `50614` |
| Kelvin | `33314` | `50604` |
| Lady Geist | `33315` | `50606` |
| Lash | `33316` | `50603` |
| McGinnis | `33317` | `50602` |
| Mina | `41313` | `50601` |
| Mirage | `33318` | `50600` |
| Mo & Krill | `33319` | `50599` |
| Nurse Harrow | `49633` | `50598` |
| Paige | `39672` | `50597` |
| Paradox | `33320` | `50596` |
| Pocket | `33321` | `50595` |
| Rat King | `49629` | `50594`, `49852` |
| Rem | `42675` | `50593` |
| Seven | `33322` | `50592` |
| Shiv | `33323` | `50591` |
| Silver | `42671` | `50587` |
| Sinclair | `36529` | `50586` |
| Solomon | `49634` | `50575` |
| Venator | `42676` | `50574` |
| Victor | `39980` | `50573` |
| Vindicta | `33324` | `50572` |
| Violet | `49631` | `50571` |
| Viscous | `33325` | `50570` |
| Vyper | `33330` | `50569` |
| Warden | `33326` | `50568` |
| Wraith | `33327` | `50567` |
| Yamato | `33328` | `50566` |

---

## SoundCategory

Eleven roots. None of them is a hero; hero association for sounds comes from the title (`inferHeroFromTitle`, `nameMentionsHero`).

| ID | Name | Items | Children |
| ---: | :--- | ---: | :--- |
| `6270` | **Abilities** | 1961 | none |
| `6310` | **Gameplay Events** | 86 | none |
| `5842` | **In-Game Music** | 795 | none |
| `6309` | **Item Sounds** | 105 | none |
| `5843` | **Killsounds** | 56 | none |
| `5895` | **Killstreak Music** | 23 | none |
| `6368` | **Movement** | 8 | none |
| `5815` | **Other/Misc** | 798 | none |
| `6308` | **Sound Packs** | 80 | none |
| `6282` | **VOs** | 318 | none |
| `6271` | **Weapons** | 94 | Melee Sounds `6306` |

## WipCategory

| ID | Name | Items |
| ---: | :--- | ---: |
| `3047` | **Audio** | 6 |
| `2855` | **Maps** | 1 |
| `2535` | **Other/Misc** | 7 |
| `2976` | **Skins** | 82 |

## ToolCategory

Not cached by the app. Live on 2026-10-24: Modding `1932`, Other/Misc `1922`, both without children.

---

## Changes since the 2024 scan

The 2024 version of this page described a flat schema and is wrong in these ways:

- Skins now has hero subcategories, so there **are** hero-specific categories for Mod skins. HUD, Model Replacement and Quality of Life/Fixes also have subcategories.
- The legacy ids `3366`, `3807`, `2114`, `2957`, `3616`, `804` and `1922` (Mod), and `5546` and `5262` (Sound), are not in the current trees. `1922` is now a ToolCategory Other/Misc and `2855` a WipCategory Maps.
- Sound "Music" (`5842`) is now **In-Game Music**, and the Sound tree grew from Other/Misc, Music, Killsounds and Killstreak Music to eleven roots.
- New Mod roots: Animations `47611` and Quality of Life/Fixes `46154`.
- The roster is 44 heroes, not 32. Tag-based hero detection (`_aTags`) is not used by the app.

## Verification

```http
GET https://api.gamebanana.com/Core/Item/Data?itemtype=ModCategory&itemid=33295&fields=name,Game().name
Response: ["Skins", "Deadlock"]
```
