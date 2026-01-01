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
- **Deadlock Categories**: Native category endpoints often fail for Deadlock. Category data must be extracted from individual mod records (see [Category Discovery](#category-discovery)).
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

## 3. Hero Filtering Limitations

> [!IMPORTANT]
> **There are NO hero-specific categories in GameBanana for Deadlock.**
>
> All hero mods are stored in generic categories like "Skins" or "Model Replacement".
> The hero association only exists in the mod's **title**, **tags**, or **description**.

### Why This Matters
- You **cannot** filter the Subfeed or Mod/Index by hero
- You **must** use the Search endpoint to find hero-specific content
- Even then, search is text-based (matches title + description + tags)

### Hero Filtering Strategies

#### Strategy 1: Search API (Recommended)
```javascript
const searchHero = async (heroName) => {
  const url = `https://gamebanana.com/apiv11/Util/Search/Results?_sSearchString=${heroName}&_idGameRow=20948`;
  const response = await fetch(url);
  const data = await response.json();
  return data._aRecords;
};
```

#### Strategy 2: Client-Side Tag Filtering
If you've already fetched all mods (e.g., from Subfeed), filter locally:
```javascript
const filterByHero = (mods, heroName) => {
  const normalized = heroName.toLowerCase();
  return mods.filter(mod => {
    // Check tags
    const hasTag = mod._aTags?.some(tag => 
      tag.toLowerCase().includes(normalized)
    );
    // Check title
    const inTitle = mod._sName?.toLowerCase().includes(normalized);
    return hasTag || inTitle;
  });
};
```

#### Strategy 3: Pre-Index on Sync
During a full sync, build a local hero-to-mod mapping:
```javascript
const heroIndex = {}; // { 'abrams': [modId1, modId2], 'ivy': [...] }

for (const mod of allMods) {
  const heroes = extractHeroesFromMod(mod);
  for (const hero of heroes) {
    if (!heroIndex[hero]) heroIndex[hero] = [];
    heroIndex[hero].push(mod._idRow);
  }
}
```

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
| `_aRootCategory` | Object | Contains `_sName`, `_idRow` (Category), `_sIconUrl`. |
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

### The "Missing Category" Problem
Querying `GET /Mod/Categories?_aGameRowIds[]=20948` often returns `400 Bad Request` or empty data for Deadlock. You cannot reliably fetch a tree of categories strictly from the API.

### Solution: Extraction Strategy
Categories must be discovered by parsing the `_aRootCategory` field from mod listings.

**The Definitive Deadlock Category Map (Verified)**
*Generated from exhaustive crawl of all 1,579 submissions*

| ID | Name | Count | Parent Type | Notes |
| :--- | :--- | ---: | :--- | :--- |
| `5815` | **Other/Misc** | 468 | Sound | **Largest bucket** - misc audio. |
| `33295` | **Skins** | 454 | Mod | Hero skins (Primary). |
| `5842` | **Music** | 226 | Sound | Soundtrack replacements. |
| `31713` | **HUD** | 98 | Mod | UI/Reticle changes. |
| `33154` | **Model Replacement** | 95 | Mod | Model swaps. |
| `31710` | **Other/Misc** | 71 | Mod | Generic mods. |
| `3366` | **Other/Misc** | 57 | Mod | Legacy misc. |
| `3807` | **Skins** | 41 | Mod | Secondary skins (Legacy). |
| `2114` | **Other/Misc** | 22 | Mod | |
| `5843` | **Killsounds** | 14 | Sound | Audio on kill. |
| `5895` | **Killstreak Music** | 9 | Sound | Audio on streaks. |
| `33331` | **Gameplay Modifications** | 6 | Mod | Scripts/gameplay tweaks. |
| `37225` | **Maps** | 4 | Mod | Level edits. |
| `5546` | **Other/Misc** | 3 | Sound | |
| `1932` | **Modding** | 3 | Tool | Modding tools/resources. |
| `2957` | **Other/Misc** | 2 | Mod | |
| `3616` | **Other/Misc** | 2 | Mod | |
| `2855` | **Maps** | 1 | Mod | Secondary maps category. |
| `804` | **Other/Misc** | 1 | Mod | |
| `5262` | **Other/Misc** | 1 | Sound | |
| `1922` | **Other/Misc** | 1 | Mod | |

### Hero Identification
Deadlock does **NOT** use sub-categories for heroes. Instead, heroes are identified via the `_aTags` array.

**Known Hero Tags** (extracted from 131 unique tags):
- `character: lash`, `character: drifter`
- `geist`, `ivy`, `hades`, `viscous`, `yamato`, `mcginnis`
- `mo & krill`, `mo and krill`, `mo&krill`
- `hero: mo & krill`

> **Implementation**: Parse `_aTags` and match against a known hero list to categorize mods by character.

*Note: The app should dynamically build its category filter list based on what it sees in the feed to handle new categories automatically.*

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
