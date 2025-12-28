use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub path: String,
    pub enabled: bool,
    pub priority: u32,
    pub size: u64,
    pub installed_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_banana_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_section: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub deadlock_path: Option<String>,
    pub auto_configure_game_info: bool,
    pub dev_mode: bool,
    pub dev_deadlock_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            deadlock_path: None,
            auto_configure_game_info: true,
            dev_mode: false,
            dev_deadlock_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub mods: Vec<ProfileMod>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMod {
    pub mod_id: String,
    pub enabled: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModConflict {
    pub mod_a: String,
    pub mod_b: String,
    pub conflicting_paths: Vec<String>,
}
