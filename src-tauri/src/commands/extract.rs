//! extract domain commands: source discovery, probe, run, cancel, advanced.
//!
//! All are typed stubs in this scaffold; the sidecar methods they will forward
//! to are listed in `docs/api-contract.md` §2/§3.

#![allow(dead_code)] // stub arg fields become live when the feature tasks land.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::commands::config::not_impl;
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathArgs {
    pub path: String,
}

#[tauri::command]
pub fn discover_videos(args: PathArgs) -> Result<Value, String> {
    not_impl(&format!("discover_videos({})", args.path))
}

#[tauri::command]
pub fn probe_video(args: PathArgs) -> Result<Value, String> {
    not_impl(&format!("probe_video({})", args.path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunArgs {
    pub config: Value,
}

/// Fire-and-forget: returns immediately; progress flows via `extract.*` events.
#[tauri::command]
pub fn start_run(args: StartRunArgs, state: State<'_, AppState>) -> Result<(), String> {
    let _ = args;
    let _ = state;
    Err("start_run: not implemented in scaffold".into())
}

#[tauri::command]
pub fn cancel_run(_state: State<'_, AppState>) -> Result<(), String> {
    Err("cancel_run: not implemented in scaffold".into())
}

#[tauri::command]
pub fn adv_open(args: PathArgs) -> Result<Value, String> {
    not_impl(&format!("adv_open({})", args.path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvSeekArgs {
    pub path: String,
    pub frame: u64,
}

#[tauri::command]
pub fn adv_seek(args: AdvSeekArgs) -> Result<Value, String> {
    not_impl(&format!("adv_seek({}, {})", args.path, args.frame))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvCaptureArgs {
    pub path: String,
    pub frame: u64,
    pub config: Value,
}

#[tauri::command]
pub fn adv_capture(args: AdvCaptureArgs) -> Result<Value, String> {
    let _ = json!({});
    not_impl(&format!("adv_capture({}, {})", args.path, args.frame))
}
