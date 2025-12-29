use crate::error::AppError;
use serde::{Deserialize, Serialize};

const GAMEBANANA_API_BASE: &str = "https://gamebanana.com/apiv11";

const DEADLOCK_GAME_ID: u64 = 20948;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaSection {
    pub plural_title: String,
    pub model_name: String,
    pub category_model_name: String,
    pub item_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaCategoryNode {
    pub id: u64,
    pub name: String,
    pub profile_url: Option<String>,
    pub item_count: u64,
    pub icon_url: Option<String>,
    pub parent_id: Option<u64>,
    pub children: Option<Vec<GameBananaCategoryNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GameBananaSectionRaw {
    #[serde(rename = "_sPluralTitle")]
    plural_title: String,
    #[serde(rename = "_sModelName")]
    model_name: String,
    #[serde(rename = "_sCategoryModelName")]
    category_model_name: String,
    #[serde(rename = "_nItemCount")]
    item_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GameBananaCategoryNodeRaw {
    #[serde(rename = "_idRow")]
    id: u64,
    #[serde(rename = "_sName")]
    name: String,
    #[serde(rename = "_sProfileUrl")]
    profile_url: Option<String>,
    #[serde(rename = "_nItemCount")]
    item_count: u64,
    #[serde(rename = "_sIconUrl")]
    icon_url: Option<String>,
    #[serde(rename = "_idParentRow")]
    parent_id: Option<u64>,
    #[serde(rename = "_aChildren")]
    children: Option<Vec<GameBananaCategoryNodeRaw>>,
}

/// Raw struct for deserializing from GameBanana API
#[derive(Debug, Clone, Deserialize)]
struct GameBananaModRaw {
    #[serde(rename = "_idRow")]
    id: u64,
    #[serde(rename = "_sName")]
    name: String,
    #[serde(rename = "_sProfileUrl")]
    profile_url: String,
    #[serde(rename = "_tsDateAdded")]
    date_added: i64,
    #[serde(rename = "_tsDateModified")]
    date_modified: i64,
    #[serde(rename = "_nLikeCount", default)]
    like_count: u32,
    #[serde(rename = "_nViewCount", default)]
    view_count: u32,
    #[serde(rename = "_bHasFiles", default)]
    has_files: bool,
    #[serde(rename = "_sInitialVisibility", default)]
    initial_visibility: Option<String>,
    #[serde(rename = "_bHasContentRatings", default)]
    has_content_ratings: bool,
    #[serde(rename = "_aSubmitter")]
    submitter: Option<GameBananaSubmitter>,
    #[serde(rename = "_aPreviewMedia")]
    preview_media: Option<GameBananaPreviewMedia>,
    #[serde(rename = "_aRootCategory")]
    root_category: Option<GameBananaCategory>,
}

/// Clean struct sent to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaMod {
    pub id: u64,
    pub name: String,
    pub profile_url: String,
    pub date_added: i64,
    pub date_modified: i64,
    pub like_count: u32,
    pub view_count: u32,
    pub has_files: bool,
    pub nsfw: bool,
    pub submitter: Option<GameBananaSubmitter>,
    pub preview_media: Option<GameBananaPreviewMedia>,
    pub root_category: Option<GameBananaCategory>,
}

impl From<GameBananaModRaw> for GameBananaMod {
    fn from(raw: GameBananaModRaw) -> Self {
        // NSFW if visibility is "warn" OR has content ratings
        let nsfw = raw.initial_visibility.as_deref() == Some("warn") || raw.has_content_ratings;

        GameBananaMod {
            id: raw.id,
            name: raw.name,
            profile_url: raw.profile_url,
            date_added: raw.date_added,
            date_modified: raw.date_modified,
            like_count: raw.like_count,
            view_count: raw.view_count,
            has_files: raw.has_files,
            nsfw,
            submitter: raw.submitter,
            preview_media: raw.preview_media,
            root_category: raw.root_category,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaSubmitter {
    #[serde(rename(deserialize = "_idRow"))]
    pub id: u64,
    #[serde(rename(deserialize = "_sName"))]
    pub name: String,
    #[serde(rename(deserialize = "_sAvatarUrl"))]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaPreviewMedia {
    #[serde(rename(deserialize = "_aImages"))]
    pub images: Option<Vec<GameBananaImage>>,
    #[serde(rename(deserialize = "_aMetadata"))]
    pub metadata: Option<GameBananaPreviewMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaPreviewMetadata {
    #[serde(rename(deserialize = "_sAudioUrl"))]
    pub audio_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaImage {
    #[serde(rename(deserialize = "_sBaseUrl"))]
    pub base_url: String,
    #[serde(rename(deserialize = "_sFile"))]
    pub file: String,
    #[serde(rename(deserialize = "_sFile220"))]
    pub file_220: Option<String>,
    #[serde(rename(deserialize = "_sFile530"))]
    pub file_530: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaCategory {
    #[serde(rename(deserialize = "_idRow"))]
    pub id: Option<u64>,
    #[serde(rename(deserialize = "_sName"))]
    pub name: String,
    #[serde(rename(deserialize = "_sModelName"))]
    pub model_name: Option<String>,
    #[serde(rename(deserialize = "_sProfileUrl"))]
    pub profile_url: Option<String>,
    #[serde(rename(deserialize = "_sIconUrl"))]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameBananaMetadata {
    #[serde(rename = "_nRecordCount")]
    pub record_count: u64,
    #[serde(rename = "_bIsComplete")]
    pub is_complete: bool,
    #[serde(rename = "_nPerpage")]
    pub per_page: u32,
}

/// Raw API response for deserialization
#[derive(Debug, Clone, Deserialize)]
struct GameBananaApiResponseRaw {
    #[serde(rename = "_aMetadata")]
    metadata: GameBananaMetadata,
    #[serde(rename = "_aRecords")]
    records: Vec<GameBananaModRaw>,
}

// Response type we send to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaModsResponse {
    pub records: Vec<GameBananaMod>,
    pub total_count: u64,
    pub is_complete: bool,
    pub per_page: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaFile {
    #[serde(rename(deserialize = "_idRow"))]
    pub id: u64,
    #[serde(rename(deserialize = "_sFile"))]
    pub file_name: String,
    #[serde(rename(deserialize = "_nFilesize"))]
    pub file_size: u64,
    #[serde(rename(deserialize = "_sDownloadUrl"))]
    pub download_url: String,
    #[serde(rename(deserialize = "_nDownloadCount"))]
    pub download_count: u32,
    #[serde(rename(deserialize = "_sDescription"))]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaModDetails {
    #[serde(rename(deserialize = "_idRow"))]
    pub id: u64,
    #[serde(rename(deserialize = "_sName"))]
    pub name: String,
    #[serde(rename(deserialize = "_sText"))]
    pub description: Option<String>,
    #[serde(rename(deserialize = "_aCategory"))]
    pub category: Option<GameBananaCategory>,
    #[serde(rename(deserialize = "_aFiles"))]
    pub files: Option<Vec<GameBananaFile>>,
    #[serde(rename(deserialize = "_aPreviewMedia"))]
    pub preview_media: Option<GameBananaPreviewMedia>,
}

pub async fn fetch_sections() -> Result<Vec<GameBananaSection>, AppError> {
    let client = reqwest::Client::new();

    let url = format!("{}/Game/{}/CategoryTree", GAMEBANANA_API_BASE, DEADLOCK_GAME_ID);
    let response = client
        .get(&url)
        .header("User-Agent", "DeadlockModManager/0.1.0")
        .send()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to fetch sections: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Settings(format!(
            "GameBanana API error: {}",
            response.status()
        )));
    }

    let sections: Vec<GameBananaSectionRaw> = response
        .json()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to parse sections: {}", e)))?;

    Ok(sections
        .into_iter()
        .map(|section| GameBananaSection {
            plural_title: section.plural_title,
            model_name: section.model_name,
            category_model_name: section.category_model_name,
            item_count: section.item_count,
        })
        .collect())
}

pub async fn fetch_category_tree(category_model: &str) -> Result<Vec<GameBananaCategoryNode>, AppError> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/Util/{}/NestedStructure?_idGameRow={}",
        GAMEBANANA_API_BASE, category_model, DEADLOCK_GAME_ID
    );

    let response = client
        .get(&url)
        .header("User-Agent", "DeadlockModManager/0.1.0")
        .send()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to fetch categories: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Settings(format!(
            "GameBanana API error: {}",
            response.status()
        )));
    }

    let categories: Vec<GameBananaCategoryNodeRaw> = response
        .json()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to parse categories: {}", e)))?;

    Ok(categories.into_iter().map(map_category_node).collect())
}

fn map_category_node(node: GameBananaCategoryNodeRaw) -> GameBananaCategoryNode {
    GameBananaCategoryNode {
        id: node.id,
        name: node.name,
        profile_url: node.profile_url,
        item_count: node.item_count,
        icon_url: node.icon_url,
        parent_id: node.parent_id,
        children: node
            .children
            .map(|children| children.into_iter().map(map_category_node).collect()),
    }
}

/// Fetch mods from GameBanana
pub async fn fetch_submissions(
    model: &str,
    page: u32,
    per_page: u32,
    search: Option<&str>,
    category_id: Option<u64>,
) -> Result<GameBananaModsResponse, AppError> {
    let client = reqwest::Client::new();

    let mut url = format!(
        "{}/{}/Index?_nPerpage={}&_aFilters[Generic_Game]={}&_nPage={}",
        GAMEBANANA_API_BASE, model, per_page, DEADLOCK_GAME_ID, page
    );

    // Add search filter if provided
    if let Some(query) = search {
        if !query.is_empty() {
            url.push_str(&format!(
                "&_sSearchString={}",
                urlencoding::encode(query)
            ));
        }
    }

    if let Some(category_id) = category_id {
        url.push_str(&format!("&_aFilters[Generic_Category]={}", category_id));
    }

    let response = client
        .get(&url)
        .header("User-Agent", "DeadlockModManager/0.1.0")
        .send()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to fetch mods: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Settings(format!(
            "GameBanana API error: {}",
            response.status()
        )));
    }

    let api_response: GameBananaApiResponseRaw = response
        .json()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to parse response: {}", e)))?;

    // Convert raw records to clean format with computed nsfw field
    let records: Vec<GameBananaMod> = api_response
        .records
        .into_iter()
        .map(GameBananaMod::from)
        .collect();

    Ok(GameBananaModsResponse {
        records,
        total_count: api_response.metadata.record_count,
        is_complete: api_response.metadata.is_complete,
        per_page: api_response.metadata.per_page,
    })
}

/// Fetch mod details including download files
pub async fn fetch_mod_details(
    model: &str,
    mod_id: u64,
) -> Result<GameBananaModDetails, AppError> {
    let client = reqwest::Client::new();

    let url = format!(
        "{}/{}/{}?_csvProperties=_idRow,_sName,_sText,_aCategory,_aFiles,_aPreviewMedia",
        GAMEBANANA_API_BASE, model, mod_id
    );

    let response = client
        .get(&url)
        .header("User-Agent", "DeadlockModManager/0.1.0")
        .send()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to fetch mod details: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Settings(format!(
            "GameBanana API error: {}",
            response.status()
        )));
    }

    let data: GameBananaModDetails = response
        .json()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to parse mod details: {}", e)))?;

    Ok(data)
}

/// Download a file from GameBanana
pub async fn download_file(
    file_url: &str,
    dest_path: &std::path::Path,
    progress_callback: impl Fn(u64, u64),
) -> Result<(), AppError> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::new();

    let response = client
        .get(file_url)
        .header("User-Agent", "DeadlockModManager/0.1.0")
        .send()
        .await
        .map_err(|e| AppError::Settings(format!("Failed to download file: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Settings(format!(
            "Download failed: {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(dest_path)
        .await
        .map_err(|e| AppError::Io(e))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Settings(format!("Download error: {}", e)))?;
        file.write_all(&chunk).await.map_err(|e| AppError::Io(e))?;
        downloaded += chunk.len() as u64;
        progress_callback(downloaded, total_size);
    }

    file.flush().await.map_err(|e| AppError::Io(e))?;

    Ok(())
}
