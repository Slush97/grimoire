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
- **Deadlock Categories**: Categories form a tree per submission type, fetched from `Util/{Model}Category/NestedStructure` (see [Category Discovery](#category-discovery)). List endpoints return a category without its id (see [Schemas](#3-schemas--fields)).
- **Item Types**: Deadlock content is split between `Mod` (visuals) and `Sound` (audio). You must query BOTH to get all content.

---

## 1. REST API (v11)
**Base URL**: `https://gamebanana.com/apiv11`

### Verified Item Types for Deadlock
The counts below come from a 2024 scan of **1,579 submissions** and are stale. On 2026-10-24 the app's local mirror held 5,427 Mod, 4,676 Sound and 117 Wip rows.

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
Retrieves full metadata for a specific mod. This is the **most reliable** source of data, including file lists and NSFW status.
`GET /Mod/{id}/ProfilePage`

**Response Includes**:
- `_aPreviewMedia`: Full gallery of images.
- `_aFiles`: List of downloadable files.
- `_sText`: Full HTML description.
- `_bIsNsfw`: Definitive NSFW boolean.

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

## 3. Hero Filtering

Mod skins have hero categories: Skins (`33295`) has one subcategory per hero, and each hero has its own nested children. Sound and Wip have no hero categories, so a hero there exists only in the **title**, **tags** or **description**. The full tree is in [gamebanana_categories_reference.md](./gamebanana_categories_reference.md).

### How the app filters
- **Mod skins**: by category id. The remote browse sends `_aFilters[Generic_Category]` with the hero's id (the filter includes descendants). The local catalog matches `sub_category_id`, which is real, over the hero's whole subtree.
- **Sound and Wip**: by title, as a whole-word match (`nameMentionsHero` in `src/lib/heroFilter.ts`).
- **Search API**: text-based only, see below.

### What Search Matches
The Search API matches your query against:
1. **Title** (`_sName`)
2. **Description** (`_sText`) 
3. **Tags** (`_aTags`)
4. **Submitter name** (sometimes)

It does **NOT** match against:
- Category names
- File names inside archives
- Comments

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
| `_aRootCategory` | Object | Tree root. List endpoints give `_sName`, `_sProfileUrl`, `_sIconUrl` and **no `_idRow`**; the id is only in the URL (`.../cats/{id}`). |
| `_aSubCategory` | Object / null | Same shape as `_aRootCategory`, for the submission's own category when it is not the root (a hero, or a nested child). `null` when filed directly under the root. |
| `_aCategory` | Object | Detail endpoints only: the submission's own category, with `_idRow`. |
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

### Fetching the tree
```http
GET https://gamebanana.com/apiv11/Util/ModCategory/NestedStructure?_idGameRow=20948
```
The same endpoint serves `SoundCategory`, `WipCategory` and `ToolCategory`. `GET /Game/20948/CategoryTree` lists the sections and their category models. Each node has `_idRow`, `_sName`, `_sProfileUrl`, `_nItemCount`, `_sIconUrl`, `_idParentRow` (children only) and `_aChildren`. The app caches Mod, Sound and Wip trees in `category_cache` and refreshes them daily.

### Category ids on submissions
List endpoints omit the category id (`_aRootCategory` and `_aSubCategory` carry only name, URL and icon), so the id is parsed from the profile URL (`categoryIdFromProfileUrl`). Detail endpoints return `_aCategory` with `_idRow`. In the local catalog `category_id` is always NULL; `category_name` holds the root name and `sub_category_id` the real subcategory id.

### Category map
The current ids, names and hierarchy (8 Mod roots, 11 Sound roots, 4 Wip roots, 44 hero subcategories under Skins) are in [gamebanana_categories_reference.md](./gamebanana_categories_reference.md), verified 2026-10-24.

*Note: the app builds its category filter list from the fetched trees, so a new category needs no code change.*

---

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

### Rate Limiting
- No official published hard limit, but aggressive polling causes temporary IP bans (429).
- **Rule of Thumb**: Max 1 request per second per client.
- **Search**: Debounce user input by at least 500ms.
