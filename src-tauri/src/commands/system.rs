//! system domain commands: update checking/install and opening folders.

use serde::Deserialize;
use serde_json::Value;

use crate::commands::config::not_impl;

#[tauri::command]
pub fn check_update() -> Result<Value, String> {
    not_impl("check_update")
}

#[tauri::command]
pub fn install_update() -> Result<Value, String> {
    not_impl("install_update")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFolderArgs {
    pub path: String,
}

#[tauri::command]
pub fn open_folder(args: OpenFolderArgs) -> Result<Value, String> {
    not_impl(&format!("open_folder({})", args.path))
}
