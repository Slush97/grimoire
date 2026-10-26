# GameBanana Categories Reference for Deadlock

Game ID: `20948`. Category response shapes verified against the public v11 API on 2026-10-25.

## Category hierarchy

Deadlock categories form a tree. A submission has one assigned category and inherits its ancestors. Hero categories live below Skins, and can have their own children. For example:

```text
Skins (33295)
  Rat King (49629)
    Faithful/Vanilla+ (50594)
    RatKing Flag (49852)
```

These IDs illustrate the response shape. Do not maintain a fixed category or hero-category map: categories can be added, renamed, and reorganized independently of Grimoire releases.

## Fetch the tree

Use the section's category model from `/Game/20948/CategoryTree`:

```http
GET https://gamebanana.com/apiv11/Util/ModCategory/NestedStructure?_idGameRow=20948
```

Browse supports `Mod`, `Sound`, and `Wip`; their category models are `ModCategory`, `SoundCategory`, and `WipCategory`. Category IDs are scoped to their model, so resolve paths using the submission's section.

Each node includes:

| Field | Meaning |
| --- | --- |
| `_idRow` | Category ID. |
| `_sName` | Display name. |
| `_sProfileUrl` | Public category URL. |
| `_sIconUrl` | Optional category icon URL. |
| `_nItemCount` | Current item count. |
| `_idParentRow` | Parent ID, when present. |
| `_aChildren` | Nested child nodes, when present. |

The recursive child structure also identifies parentage. Walk it to build a root-to-leaf path for each category ID; this works with cached trees even when their optional parent fields are missing.

## Category fields on submissions

`/Mod/Index` and `/Util/Search/Results` already return the category references Grimoire needs when `_aRootCategory,_aSubCategory` are selected:

- `_aRootCategory` is the top ancestor, such as Skins.
- `_aSubCategory` is the assigned category, including a deeply nested child such as RatKing Flag. It is null when the submission belongs directly to its root.
- These list references commonly omit `_idRow`; obtain it from `_sProfileUrl`, such as `https://gamebanana.com/mods/cats/49852`.

The existing details request returns `_aCategory`, the assigned category. `_aSuperCategory`, when requested, gives only its immediate parent, so it does not replace the full tree for nested paths.

Verified example: [Rey rata Comunidad de Madrid](https://gamebanana.com/mods/732110) has the leaf RatKing Flag. Its full path is Skins, Rat King, RatKing Flag. A single list response plus the shared tree supplies all three labels; fetching details for every Browse card is unnecessary.

## Existing cache and request cost

`electron/main/services/gamebanana.ts` owns `fetchCategoryTreeCached`:

- Stores each model's tree in the existing `category_cache` table in `mods-cache.db`.
- Returns the stored tree immediately, including offline.
- Refreshes trees older than 24 hours in the background.
- Supports an explicit awaited revalidation after one hour, falling back to the stored tree if unavailable.
- Shares concurrent cold loads and refreshes for the same model.

The catalog sync already stores the root category ID/name and deepest `sub_category_id` on each mod. Older cached rows may have a null root ID; their leaf ID and root name still allow tree resolution without a migration or full refetch.

Displaying category paths adds no per-card API calls. It may load a section's shared tree once when first needed; subsequent cards, scrolling, details views, and app restarts reuse that cache. A combined feed uses one tree per included category model.

The renderer rereads this existing cache when Browse or details opens, sharing concurrent reads. Unchanged trees retain their indexes and hero-map references so this does not redraw all cards. Refreshed trees rebuild those indexes, and a failed read retains any tree already available in memory.

Installed inventory loading also warms the relevant section trees through this same cache in the background, so a missing tree does not delay the library. Main-process enrichment and locked mutations read a synchronous index of the cached payload; they do not fetch a tree for every mod or make requests while changing files. An unavailable tree falls back to the saved category label without inventing ancestors. A successfully changed cached tree notifies the renderer to silently refresh installed metadata and any loaded category index. Cache reads and timestamp-only refreshes do not emit that event.

## Hero labels and filtering

Match category names to the app's supported hero names and aliases to render hero icons in place of those text labels. Keep other ancestors and leaf categories as text. Do not infer a different category path from a mod's title when explicit category metadata is available.

For Browse Mod hero filters, include the hero category and all descendant IDs so nested categories still match. Browse Sound and Wip filtering uses catalog title matching where their trees do not provide equivalent hero categories. Browse card title matching also uses the cached category tree's hero roster and existing aliases, so it recognizes additions beyond the bundled roster without per-card requests. Explicit hero categories take precedence over titles.

Browse title matching accepts `Deadman` or `Danny` for Deadman Danny, `Harrow` for Nurse Harrow, and both `Rat King` and `RatKing`. These are whole-name matches, so unrelated words such as `harrowing` do not identify a hero.

Sound cards use a hero portrait only when they resolve to exactly one hero. A multi-hero file or variant group uses the ordinary Sound preview, retaining any explicit thumbnail. Installed, classic Browse, and list cards show every hero icon. Readable Browse captions collapse more than two heroes into one icon and a compact `+n` tooltip, keeping their fixed height and action button clear.

Installed cards and filter facets share `installedCardTaxonomy.ts` and the category-tree indexes:

- The Tags filter includes every non-hero ancestor and leaf label, plus the existing Sounds/Wip section tags. Heroes have their separate filter.
- Cards display all resolved hero icons and the representative file's deepest non-hero category. A compact `+n` chip lists the remaining tags in its normal mouse tooltip.
- Grouped variants contribute their combined categories and hero identities, with each group counted once per filter option.
- When variant hero sets differ, the installed variant picker shows each file's own hero icons. It omits these repeated icons when all files target the same heroes, and never adds category text to the variant rows.
- Category labels retain GameBanana's spelling and singular/plural forms. The known upstream typo `Faithul/Vanilla+` is displayed as `Faithful/Vanilla+`, retaining the original category ID.
- Identical labels share a filter option. There is no synthetic Other bucket or a second tag generated from Locker's General classification for linked mods.

## Installed hero detection

Mod-section skin ownership comes from its category ancestry. Installed Sound, Wip, and HUD files use the same local detector, which can return several supported heroes. Recognize HUD descendants through the cached Mod category path, with saved-label fallback offline:

1. Inspect recognized asset paths inside that file's VPK. Resolve sound and model codenames through their existing namespaces and supported-hero mappings; NPC and unsupported hero tokens do not count.
2. If any supported heroes are found, use that complete set and skip text matching.
3. Otherwise check the GameBanana per-file description, then original archive/VPK filenames, then the mod submission name. Stop at the first level with supported hero matches, retaining every hero from that level. Missing descriptions simply fall through. Never use Grimoire's renamed `pakNN` filename.

Detect each installed variant separately. Updating a Sound, Wip, or HUD detects heroes from every replacement VPK, including an already-installed successor reused by an update, without copying the predecessor's automatic matches.

The detection result records the file size, modified time, matching inputs and detector version, including an empty result. Unchanged files reuse it. Manual hero assignments remain authoritative. See [the codename reference](hero-sound-codenames.md) for path namespaces and exclusions.

## Locker General routing and metadata upgrade

GameBanana-linked files derive Locker General routing from their category path: HUD descendants use HUD, and Hideout, Soul Container, Spirit Urn and Killstreak Music map to the existing corresponding destinations. Automatic hero attribution on a HUD supplies icons while retaining its HUD routing and shuffle bucket. Other resolved heroes or a manual hero assignment take precedence over automatic General routing. An explicit manual General assignment, including an unassigned choice, is authoritative.

General routing no longer scans VPKs to invent a classification. Existing local classifications, manual assignment and classifications attached to locally generated Soul Container/Spirit Urn imports remain usable. General routing is independent of the Global priority-folder placement setting.

The metadata upgrade removes legacy unmarked General classifications from GameBanana-linked rows and clears their old nonmanual Sound/Wip hero tags so the new detector can recalculate them. Local metadata and explicit manual hero assignments are preserved. Before the first change, the original active sidecar is copied into its mode-specific backup directory; failure to create the backup or atomically write the upgrade stops the operation. Normal and developer metadata upgrade independently. Incoming old backup/import metadata is sanitized on write so retired fields cannot return. Category tag lists are derived at runtime and are not persisted.

Related code: `gamebanana.ts`, `syncService.ts`, `modDatabase.ts`, `src/lib/heroFilter.ts`, and the shared renderer category resolver. See also [the API reference](gamebanana_api_reference.md).
