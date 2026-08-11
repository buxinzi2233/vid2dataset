//! runtime domain commands: tagger and GPU runtime resources.
//!
//! These two concern "runtime assets that may need a one-time download" and
//! share the same request/event shape (`download.progress`), so they live in
//! one module instead of two near-empty files.

#![allow(dead_code)] // GPU stubs become live with the GPU feature task.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::commands::config::not_impl;
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

#[tauri::command]
pub fn gpu_detect() -> Result<Value, String> {
    not_impl("gpu_detect")
}

#[tauri::command]
pub fn gpu_status() -> Result<Value, String> {
    not_impl("gpu_status")
}

#[tauri::command]
pub fn gpu_download() -> Result<Value, String> {
    not_impl("gpu_download")
}
