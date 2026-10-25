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

## Hero labels and filtering

Match category names to the app's supported hero names and aliases to render hero icons in place of those text labels. Keep other ancestors and leaf categories as text. Do not infer a different category path from a mod's title when explicit category metadata is available.

For Mod hero filters, include the hero category and all descendant IDs so nested categories still match. Sound and Wip filtering currently falls back to title matching where their trees do not provide equivalent hero categories.

Installed cards and filter facets share `installedCardTaxonomy.ts` and the same category-tree indexes. A hero leaf becomes a hero icon rather than a second text tag. A General classification keeps precedence over a GameBanana category on Installed cards; filters also retain distinct leaf categories and section tags. Filter labels have normalized identities independent of their source, so a GameBanana HUD category and a HUD classification contribute to one option. Grouped variants count once per option. This normalization does not rewrite `categoryId`, `categoryName`, `lockerHero`, or `globalType`; these fields retain their provenance and manual overrides, so no metadata migration is needed.

The equivalent singular category labels Soul Container and Spirit Urn use the existing plural classification labels in Installed tags. Hero-only and unclassified files do not receive a synthetic Other tag or any replacement bucket.

Related code: `gamebanana.ts`, `syncService.ts`, `modDatabase.ts`, `src/lib/heroFilter.ts`, and the shared renderer category resolver. See also [the API reference](gamebanana_api_reference.md).
