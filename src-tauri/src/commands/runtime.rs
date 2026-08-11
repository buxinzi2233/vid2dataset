//! runtime domain commands: tagger and GPU runtime resources.
//!
//! These two concern "runtime assets that may need a one-time download" and
//! share the same request/event shape (`download.progress`), so they live in
//! one module instead of two near-empty files.

#![allow(dead_code)] // stub arg fields become live when the feature tasks land.

use serde::Deserialize;
use serde_json::Value;

use crate::commands::config::not_impl;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelArgs {
    pub model: String,
}

#[tauri::command]
pub fn tagger_status(args: ModelArgs) -> Result<Value, String> {
    not_impl(&format!("tagger_status({})", args.model))
}

#[tauri::command]
pub fn tagger_download(args: ModelArgs) -> Result<Value, String> {
    not_impl(&format!("tagger_download({})", args.model))
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
