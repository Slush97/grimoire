# GameBanana API Reference for Deadlock

> **Game ID**: `20948` (Deadlock)
> **API Base URLs**:
> - Core (Legacy): `https://api.gamebanana.com`
> - REST (Modern): `https://gamebanana.com/apiv11`

## Overview

Deadlock modding integrations primarily rely on the GameBanana API. Due to the platform's history, two distinct API systems exist. Modern integrations should utilize the **REST API** for data retrieval (browsing, searching, downloading) while reserving the **Core API** for schema introspection and auxiliary metadata.

### ⚠️ Critical Implementation Notes
- **Empty JSON Responses**: The API frequently returns empty responses (0 bytes) instead of JSON errors. Validating the response body before parsing is mandatory.
- **Sparse Responses**: List endpoints (Search, Subfeed) return minimal data. Important flags like `_bIsNsfw` are often missing from lists and only appear in Detail requests.
- **Deadlock Categories**: Use the nested category tree and the root/leaf references already returned by listings. See [Category Discovery](#4-category-discovery).
- **Item Types**: Deadlock content is split between `Mod` (visuals) and `Sound` (audio). You must query BOTH to get all content.

---

## 1. REST API (v11)
**Base URL**: `https://gamebanana.com/apiv11`

### Verified Item Types for Deadlock
Based on scanning all **1,579 submissions**:

| Item Type | Count | Usage |
| :--- | ---: | :--- |
| **Mod** | 728 | Skins, HUDs, gameplay tweaks. |
| **Sound** | 717 | Audio replacements, music, voice lines. |
| **Request** | 98 | User requests for new mods. |
| **Question** | 22 | Help/Support threads. |
| **Tool** | 4 | Utilities and tools. |
| **Thread** | 3 | Discussion posts. |
| **Tutorial** | 2 | How-to guides. |
| **Script** | 2 | Configs/Scripts. |
| **Concept** | 1 | Concept art/ideas. |
| **Spray** | 1 | Spray images. |
| **Wip** | 1 | Work in progress. |

> **Note**: If filtering to "actual content" (Mod + Sound + Tool + Script + Spray = **1,452 items**), this closely matches typical mod manager databases.

### Endpoints

#### Global Feed (Subfeed)
Retrieves the main feed of new submissions for Deadlock.
`GET /Game/20948/Subfeed`

**Parameters:**
- `_nPage` (int): Page number (1-based).
- `_nPerpage` (int): Items per page (default: 15, max: 50 recommended).
- `_csvProperties` (string): Comma-separated list of fields to retrieve (see [Schema](#schemas)).

**Example:**
```http
GET https://gamebanana.com/apiv11/Game/20948/Subfeed?_nPage=1&_nPerpage=15&_csvProperties=_idRow,_sName,_aRootCategory,_sProfileUrl
```

#### Search
Search for specific mods within Deadlock.
`GET /Util/Search/Results`

**Parameters:**
- `_sSearchString` (string): The search query.
- `_idGameRow` (int): Must be `20948` for Deadlock.
- `_sModelName` (string): Scope to model, e.g., `Mod`.
- `_nPage`, `_nPerpage`: Pagination.

**Example:**
```http
GET https://gamebanana.com/apiv11/Util/Search/Results?_sSearchString=hud&_idGameRow=20948&_sModelName=Mod
```

#### Mod Details
Retrieves selected metadata for a specific mod, including file lists, its assigned category, and NSFW status. Grimoire uses `GET /Mod/{id}?_csvProperties=...`; `/Mod/{id}/ProfilePage` is available when profile-specific fields are needed.

**Response Includes**:
- `_aPreviewMedia`: Full gallery of images.
- `_aFiles`: List of downloadable files.
- `_sText`: Full HTML description.
- `_bIsNsfw`: Definitive NSFW boolean.

Image entries in `_aPreviewMedia._aImages` can include an optional `_sCaption`.
This is the author-written text shown below enlarged screenshots on GameBanana,
not the HTML `alt` attribute. It is also returned by the existing
`/Mod/{id}?_csvProperties=_aPreviewMedia` request, so no extra request is needed.
Grimoire maps it to `GameBananaImage.caption` and displays it as plain text below
the image in the mod-details lightbox. Missing or blank captions are hidden.
Scroll over the full-size viewer to zoom toward the pointer, up to 8x the fitted
size. Zooming hides the controls with a short fade; dragging pans the enlarged
image within its edges. At fitted size, clicking the image toggles the controls.
Zooming back out restores them. Switching images or reopening the viewer resets
zoom and pan. Captions remain selectable, and their own scrolling is preserved.

---

## 2. Search API

### Endpoint
`GET /Util/Search/Results`

### Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `_sSearchString` | string | Yes | The search query (hero name, mod name, etc.) |
| `_idGameRow` | int | Yes | Must be `20948` for Deadlock |
| `_sModelName` | string | No | Filter to specific type: `Mod`, `Sound`, etc. |
| `_nPage` | int | No | Page number (1-indexed) |
| `_nPerpage` | int | No | **IGNORED** - API forces 15/page |

### Response Structure
```json
{
  "_aMetadata": {
    "_nRecordCount": 45,       // Total matching results
    "_nPerpage": 15,           // Always 15, ignores your request
    "_bIsComplete": false,     // More pages available
    "_aSectionMatchCounts": [  // Breakdown by item type
      { "_sModelName": "Mod", "_nMatchCount": 28 },
      { "_sModelName": "Sound", "_nMatchCount": 13 },
      { "_sModelName": "Request", "_nMatchCount": 4 }
    ]
  },
  "_aRecords": [ ... ]         // Actual results (max 15)
}
```

### Key Insight: `_aSectionMatchCounts`
This array gives you a **pre-calculated breakdown** by item type without needing to paginate through all results. Extremely useful for UI counters.

### Example: Search for Hero
```http
GET https://gamebanana.com/apiv11/Util/Search/Results?_sSearchString=abrams&_idGameRow=20948
```

**Sample Results:**
| Hero | Total | Mods | Sounds | Requests |
| :--- | ---: | ---: | ---: | ---: |
| Abrams | 45 | 28 | 13 | 4 |
| Yamato | 40 | 19 | 18 | 3 |
| Ivy | 55 | 34 | 14 | 5 |

---

## 3. Hero and Category Filtering

Deadlock Mod categories are hierarchical. Skins contains hero categories, which can themselves contain nested variants or types such as RatKing Flag and Faithful/Vanilla+.

- Use `/Util/{categoryModel}/NestedStructure?_idGameRow=20948` for the dynamic tree.
- Remote listings can filter by category using `_aFilters[Generic_Category]`; a hero category includes its descendants.
- The local catalog stores the deepest `sub_category_id`. Filter it against the selected hero's full subtree rather than matching the title of Mod skins.
- Sound and Wip currently use title matching when their category trees provide no corresponding hero category.
- Category paths and hero icons use explicit category metadata. A title mentioning a hero does not change the submission's assigned categories.

See [Category Discovery](#4-category-discovery) for field shapes and cache reuse.

## 2. Core API (Legacy)
**Base URL**: `https://api.gamebanana.com`
Used for: Introspection, Schema definition, Allowed values.

#### Introspection Endpoints
These endpoints are useful for building dynamic queries or validating allowed parameters.

| Endpoint | Description |
| :--- | :--- |
| `GET /Core/Item/Data/AllowedFields?itemtype=Mod` | Returns all ~55 valid fields for Mods. |
| `GET /Core/Item/Data/AllowedFields?itemtype=Game` | Returns all ~26 valid fields for Games. |
| `GET /Core/Item/Data/AllowedItemTypes` | Lists all 60+ supported item types (Mod, Sound, etc.). |
| `GET /Core/List/Section/AllowedSorts?itemtype=Mod` | specific sort keys (e.g., `date`, `downloads`). |

---

## 3. Schemas & Fields

### Mod Object (`itemtype=Mod`)
Core allowed fields available in `_csvProperties` or detail responses.

| Field | Type | Description |
| :--- | :--- | :--- |
| `_idRow` | Int | Unique Mod ID. |
| `_sName` | String | Title of the mod. |
| `_sProfileUrl` | String | Full URL to the mod page. |
| `_aRootCategory` | Object | Root category reference. List responses often omit `_idRow`; parse `_sProfileUrl`. |
| `_aSubCategory` | Object/null | Assigned category on listings/search, including deeply nested children; null for root-only items. |
| `_aCategory` | Object | Assigned category on detail responses. |
| `_aPreviewMedia` | Object | Contains `_aImages` array (screenshots). |
| `_bIsNsfw` | Boolean | **Crucial**: True if content is mature. *Often missing in List views.* |
| `_bHasContentRatings` | Boolean | **Proxy**: Reliable indicator of NSFW content in List views where `_bIsNsfw` is null. |
| `_tsDateAdded` | Timestamp | Unix timestamp of creation. |
| `_tsDateUpdated` | Timestamp | Unix timestamp of last update. |
| `_sVersion` | String | Version string (e.g., "1.0"). |
| `_aSubmitter` | Object | User info: `_sName`, `_sAvatarUrl`, `_bIsOnline`. |
| `_nLikeCount` | Int | Number of likes. |
| `_nViewCount` | Int | Number of views. |
| `_nDownloadCount` | Int | Number of downloads. **⚠️ NOT available in Subfeed/list views - only in Detail endpoints.** |

### Game Object (`itemtype=Game`)
Fields specific to the Game entity (Deadlock).

| Field | Description |
| :--- | :--- |
| `name` | "Deadlock" |
| `blurb` | Short description. |
| `credits` | Game credits. |
| `publisher` | "Valve" |
| `developer` | "Valve" |
| `mdate` | Modification date. |

---

## 4. Category Discovery

Use the live nested tree rather than a hardcoded list or per-submission discovery:

```http
GET https://gamebanana.com/apiv11/Util/ModCategory/NestedStructure?_idGameRow=20948
```

`/Game/20948/CategoryTree` lists sections and their category model names. NestedStructure returns `_aChildren` and the optional `_idParentRow`, allowing complete root-to-leaf paths.

Listings and searches already select `_aRootCategory` and `_aSubCategory`. The latter identifies the assigned leaf, even below a hero category. Both references often omit `_idRow`; parse their `_sProfileUrl` to recover it. `_aSubCategory` is null for root-only submissions.

The details request already selects `_aCategory`, the assigned leaf. `_aSuperCategory` represents only its immediate parent and is unnecessary when resolving through the shared tree.

Grimoire reuses `fetchCategoryTreeCached` and the SQLite `category_cache` table. It serves stored trees offline, refreshes after 24 hours, and shares simultaneous requests for a model. Catalog rows already retain the deepest `sub_category_id`, so category paths on Browse cards require no per-mod details calls or new cache schema.

See [GameBanana Categories Reference](gamebanana_categories_reference.md) for a verified nested example, field definitions, and offline fallbacks.

---

### Requirement labels

The raw `_aRequirements` rows contain `[name, url, importance, state]`. Verified importance codes are `1` (Required) and `2` (Recommended). `ProfilePage` expands this to `[name, url, stateLabel, stateColor, importanceLabel, importanceColor]`. Keep Recommended separate from Required; only Required entries participate in missing-dependency and load-order warnings.

Installed, Enabled, Present, and On are state labels, separate from importance. Older two-column `[name, url]` entries have no importance label: infer Optional from the whole word `optional` in the name first, then Recommended from `recommended`, ignoring case. Otherwise default to Required. Explicit API labels take precedence over the name. Unknown codes use the existing ProfilePage label request before applying the same fallback to any unresolved importance.

### Reference responses

- [Required and Recommended with different states](https://gamebanana.com/apiv11/Mod/589554/ProfilePage?_csvProperties=_aRequirements)
- [Raw importance and state codes](https://gamebanana.com/apiv11/Mod/589554?_csvProperties=_aRequirements)

## 5. File Downloads

Downloading is a multi-step process to ensure valid links.

1. **Get Mod Details**: Call `/Mod/{id}/ProfilePage`.
2. **Locate File**: Parse `_aFiles` array.
3. **Download URL**: usage standard pattern: `https://gamebanana.com/dl/{_idRow}` (File ID).

**Archives**: Files are typically `.zip`, `.rar`, or `.7z`. The client **must** support all three.

---

## 6. Best Practices

### NSFW Handling
Deadlock has a significant number of NSFW submissions.
1. **List View**: Check `_bIsNsfw`. If missing, check `_bHasContentRatings`. If `true`, treat as potentially NSFW (blur it).
2. **Detail View**: `_bIsNsfw` is authoritative here. Update your local cache with this value.

### Data Caching
- **Thumbnails**: Cache aggressively. Use the `_wFile###` fields (e.g., `_sFile220`, `_sFile530`) to select appropriate sizes and save bandwidth.
- **Feed**: Cache the subfeed response for 1-5 minutes to avoid hitting rate limits on frequent tab switches.
- **Categories**: Reuse the persistent tree cache and catalog leaf IDs; resolve ancestors locally rather than fetching each Browse card's details.

### Rate Limiting
- No official published hard limit, but aggressive polling causes temporary IP bans (429).
- Grimoire routes API requests through `gamebananaRateLimiter` (10 requests/second, burst 20). This is a client-side limit, not a published server allowance.
- **Search**: Debounce user input by at least 500ms.
