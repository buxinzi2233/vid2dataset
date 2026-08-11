//! runtime domain commands: tagger and GPU runtime resources.
//!
//! These two concern "runtime assets that may need a one-time download" and
//! share the same request/event shape (`download.progress`), so they live in
//! one module instead of two near-empty files.

#![allow(dead_code)] // GPU stubs become live with the GPU feature task.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelArgs {
    pub model: String,
}

#[tauri::command]
pub fn tagger_status(args: ModelArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("tagger.status", json!({ "model": args.model }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

/// Fire-and-forget: sidecar answers fast with `{"started": true}` and streams
/// `download.progress` / `download.done` events.
#[tauri::command]
pub fn tagger_download(args: ModelArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("tagger.download", json!({ "model": args.model }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggerRunArgs {
    pub folder: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub trigger_word: String,
    #[serde(default)]
    pub blacklist: String,
    #[serde(default)]
    pub require: String,
    #[serde(default)]
    pub exclude: String,
    #[serde(default)]
    pub always: String,
    #[serde(default)]
    pub trait_prune_threshold: f64,
    #[serde(default)]
    pub general_threshold: f64,
    #[serde(default)]
    pub character_threshold: f64,
    #[serde(default = "default_true")]
    pub use_gpu: bool,
}

fn default_true() -> bool {
    true
}

/// Fire-and-forget: sidecar answers fast with `{"started": true}` and streams
/// `extract.progress` (`stage="tag:tagging"`) / `tagger.done` events.
#[tauri::command]
pub fn tagger_run(args: TaggerRunArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("tagger.run", json!({
            "folder": args.folder,
            "model_name": args.model_name,
            "trigger_word": args.trigger_word,
            "blacklist": args.blacklist,
            "require": args.require,
            "exclude": args.exclude,
            "always": args.always,
            "trait_prune_threshold": args.trait_prune_threshold,
            "general_threshold": args.general_threshold,
            "character_threshold": args.character_threshold,
            "use_gpu": args.use_gpu,
        }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[tauri::command]
pub fn gpu_detect(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request("gpu.detect", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[tauri::command]
pub fn gpu_status(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request("gpu.status", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

/// Fire-and-forget: sidecar answers fast with `{"started": true}` and streams
/// `download.progress` / `download.done` events.
#[tauri::command]
pub fn gpu_download(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request("gpu.download", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}
