//! config domain commands: version, language, prefs, presets, folder browse.
//!
//! `list_presets` and `config_defaults` forward to the live sidecar methods;
//! the rest are stubs with typed signatures (see `docs/api-contract.md` §3).

#![allow(dead_code)] // stub arg fields become live when the feature tasks land.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::bridge::protocol::ErrorInfo;
use crate::state::AppState;

const VERSION: &str = "1.2.0";

#[tauri::command]
pub fn get_version() -> String {
    VERSION.into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLangArgs {
    pub lang: String,
}

#[tauri::command]
pub fn get_lang() -> Result<String, String> {
    Err("get_lang: not implemented in scaffold".into())
}

#[tauri::command]
pub fn set_lang(args: SetLangArgs) -> Result<(), String> {
    let _ = args;
    Err("set_lang: not implemented in scaffold".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPrefsArgs {
    pub prefs: Value,
}

#[tauri::command]
pub fn get_prefs() -> Result<Value, String> {
    Err("get_prefs: not implemented in scaffold".into())
}

#[tauri::command]
pub fn set_prefs(args: SetPrefsArgs) -> Result<(), String> {
    let _ = args;
    Err("set_prefs: not implemented in scaffold".into())
}

/// List built-in presets from the live sidecar (`presets.list`).
#[tauri::command]
pub fn list_presets(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("presets.list", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or(ErrorInfo {
            code: "ERR".into(),
            message: "".into(),
        });
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPresetArgs {
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePresetArgs {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub config: Value,
}

#[tauri::command]
pub fn load_preset(args: LoadPresetArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("presets.load", json!({ "name": args.name }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[tauri::command]
pub fn save_preset(args: SavePresetArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request(
        "presets.save",
        json!({
            "name": args.name,
            "description": args.description,
            "config": args.config,
        }),
    );
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[tauri::command]
pub fn config_defaults(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("config.defaults", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or(ErrorInfo {
            code: "ERR".into(),
            message: "".into(),
        });
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateConfigArgs {
    pub config: Value,
}

/// Validate a config dict via the sidecar's Pydantic model.
/// Returns `{"valid": bool, "errors": [{field, message}]}`.
#[tauri::command]
pub fn config_validate(
    args: ValidateConfigArgs,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("config.validate", json!({ "config": args.config }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or(ErrorInfo {
            code: "ERR".into(),
            message: "".into(),
        });
        Err(format!("{}: {}", e.code, e.message))
    }
}

/// Open a native folder picker; returns the chosen path or null when cancelled.
#[tauri::command]
pub async fn browse_folder(_app: AppHandle) -> Result<Option<String>, String> {
    _app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|e| format!("invalid selected folder: {e}"))
        })
        .transpose()
}
