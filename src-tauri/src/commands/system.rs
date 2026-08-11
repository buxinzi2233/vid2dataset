//! system domain commands: update checking/install and opening folders.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn check_update(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request("update.check", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[tauri::command]
pub fn install_update(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request("update.install", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFolderArgs {
    pub path: String,
}

#[tauri::command]
pub fn open_folder(args: OpenFolderArgs) -> Result<Value, String> {
    Err(format!("open_folder({}): not implemented", args.path))
}
