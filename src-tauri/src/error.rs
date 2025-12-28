use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Deadlock installation not found")]
    DeadlockNotFound,

    #[error("Invalid Deadlock path: {0}")]
    InvalidDeadlockPath(String),

    #[error("Mod not found: {0}")]
    ModNotFound(String),

    #[error("Settings error: {0}")]
    Settings(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

// Make error serializable for Tauri
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
