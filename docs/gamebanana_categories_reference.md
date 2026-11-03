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

Mod details place the category tags above Files. Requirements share one compact card below current and archived files, before the artist information. Their thumbnails and names open the linked mod's details. Required and Recommended tags sit beside the existing actions; downloads remain in the linked mod's file section.

Enabling an installed mod with required dependencies opens a confirmation with
**Enable all**, **Only this**, and **Disable**. Disabling a dependency used by
enabled mods offers **Disable all**, **Only this**, and **Enable**. The compact
list includes thumbnails, requirement importance, and checkboxes that immediately
enable or disable individual installed mods. Missing requirements stay visible
with disabled checkboxes and links to their details. Required dependencies and
enabled dependents are followed transitively, with cycle protection; optional
dependencies trigger a confirmation only when **Prompt for optional requirements**
is enabled in Settings > Preferences (off by default). This includes recommended
dependencies and only changes when the enable dialog opens. Another enabled variant can satisfy
the same requirement without disabling its dependents.

**View requirements** in a mod's context menu opens the same list with
**Enable all** and **Disable all** actions. It also lists enabled mods that require
this mod, marking them as **Requires this mod**. The requirements icon also opens it.
Required dependency problems on an enabled mod use a yellow icon; disabled mods
and optional-only requirements use light gray. Requirements do not appear in
the Installed **Issues** menu.

For Browse Mod hero filters, include the hero category and all descendant IDs so nested categories still match. Browse Sound and Wip filtering uses catalog title matching where their trees do not provide equivalent hero categories. Browse card title matching also uses the cached category tree's hero roster and existing aliases, so it recognizes additions beyond the bundled roster without per-card requests. Explicit hero categories take precedence over titles.

Browse title matching accepts `Deadman` or `Danny` for Deadman Danny, `Harrow` for Nurse Harrow, and both `Rat King` and `RatKing`. These are whole-name matches, so unrelated words such as `harrowing` do not identify a hero.

Sound cards use a hero portrait only when they resolve to exactly one hero. A multi-hero file or variant group uses the ordinary Sound preview, retaining any explicit thumbnail. Classic Browse and list cards show every hero icon. Readable Browse captions collapse more than two heroes into one icon and a compact `+n` tooltip, keeping their fixed height and action button clear.

Installed cards and filter facets share `installedCardTaxonomy.ts` and the category-tree indexes:

- The Tags filter includes every non-hero ancestor and leaf label, plus the existing Sounds/Wip section tags. Heroes have their separate filter.
- Installed cards use 22px hero icons in a stack capped at 66px. Earlier heroes overlap in front of later heroes. Up to five hero icons are visible; from six heroes onward, four icons and a shadowed Soul Urn represent the group. The urn shares the overlapping slots and always sits behind every hero. The stack's mouse tooltip lists every hero separated by commas. The reusable 64px urn asset keeps its original colors; only this overflow treatment darkens it with CSS.
- Card category tags run from the representative file's leaf toward its ancestors, with deeper categories before parents and custom fallback labels last. Their single 22px-high line fits as many tags as the available width allows, reserving the measured width of a `+n` chip whose mouse tooltip lists the remaining labels. Filter tag sets and counts are unchanged.
- Grouped variants contribute their combined categories and hero identities, with each group counted once per filter option.
- CameraOff, FileWarning, and requirements indicators share one overlapping stack before the hero stack and category tags in every Installed layout. Each 16px icon is centered in a 22px slot, with their shared stack currently capped at 110px. Severity colors and detailed tooltips are retained. Other warning badges keep their existing placement. Merged-source updates use the normal orange Update tag without an extra hover effect; source counts and replacement details remain in its tooltip.
- When variant hero sets differ, the installed variant picker shows each file's own hero icons. It omits these repeated icons when all files target the same heroes, and never adds category text to the variant rows.
- Category labels retain GameBanana's spelling and singular/plural forms. The known upstream typo `Faithul/Vanilla+` is displayed as `Faithful/Vanilla+`, retaining the original category ID.
- Identical labels share a filter option. There is no synthetic Other bucket or a second tag generated from Locker's General classification for linked mods.

Disabled Installed cards with resolved hero tags show a hover-only swap action
beside More actions when an enabled card shares a hero. A single match swaps
directly; multiple matches, or a replacement tagged for several heroes, use a
dropdown of enabled card names with their hero icons in the cards' 66px overlapping
stack. Each enabled card appears once, and disabled
variants do not contribute hero matches for an enabled group. Matching uses the
complete visible library before search and filter narrowing.

For a replacement with several VPKs, choosing the outgoing card opens the existing
variant picker. Closing it leaves the outgoing mod enabled. The first successful
replacement enable disables only the chosen outgoing card's enabled files;
subsequent picker toggles remain independent. Requirements confirmations and
safety review still apply. The main process holds one mutation lock, enables
replacements before disabling outgoing files, and restores moved files on failure.
The chosen replacement inherits the outgoing card's exact folder and load-order
slot (its first slot when several files are enabled), leaving other mods in place.
Global placement follows that slot, including its persisted priority flag.
Game-loaded outgoing files block the swap with the usual warning and shake
feedback on both rendered cards, including when the lock changes during selection.

Installed's Hero selector supports several heroes, matching any selected hero.
Selected heroes share the cards' 66px overlapping stack, showing up to eight
icons before an overflow urn. Its tooltip lists every selected hero.
Its Tags selector includes tags on left-click (green plus) and excludes them on
right-click (red minus). A card must match an included tag when any are selected,
and must not match any excluded tag. Either click clears a tag that is already
included or excluded. The trigger shows a single tag as `+ HUD` or `- HUD`.
Multiple selections show separate counts, such as `+2/-1 Tags`, with empty sides
and their separator omitted.
The selector's search can be switched to edit mode to create, rename, or delete
custom tags. The edit toggle sits beside the input; renaming uses that same input
and Enter to save, with an X to cancel.
Custom tags appear first during editing. GameBanana categories and
local General classifications remain read-only. Assign custom tags through the
card's Custom Tags submenu. These user preferences reuse the list catalogue
operations and are saved separately per installation and normal/developer mode.
Grouping and splitting retain their membership through the existing stable-key
mapping; no category data is rewritten.

Installed sorting lives inside Filters. Hero (A-Z) uses the first alphabetic
resolved hero, puts entries without heroes last, and breaks hero ties by load
order. Recently Added uses the newest install time across variants.
Sort choices do not activate the Filters button or its Clear all action.
Clearing filters preserves the selected sort.
Manual disabled-card ordering applies only to
Load Order; the other sort modes take precedence while retaining favorites.
Filters also contains the Default/Lists view switch and list management, even
when no custom lists exist. Its Source, Status, and view segments use neutral
selection colors; selected hero and tag dropdown triggers retain accent hints.

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
