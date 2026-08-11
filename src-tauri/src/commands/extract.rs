//! extract domain commands: source discovery, probe, run, cancel, advanced.
//!
//! `start_run` / `cancel_run` forward to the live sidecar. The rest are typed
//! stubs (sidecar methods listed in `docs/api-contract.md` §2/§3).

#![allow(dead_code)] // remaining stub arg fields become live with feature tasks.

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
pub fn discover_videos(args: PathArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("source.discover", json!({ "path": args.path }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[tauri::command]
pub fn probe_video(args: PathArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("source.probe", json!({ "path": args.path }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunArgs {
    pub config: Value,
}

/// Fire-and-forget: forwards to sidecar `extract.run`, which answers fast with
/// `{"started": true}` and streams `extract.progress/log/done` events.
#[tauri::command]
pub fn start_run(args: StartRunArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("extract.run", json!({ "config": args.config }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

/// Ask the sidecar to set its extraction cancel event.
#[tauri::command]
pub fn cancel_run(state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.bridge.lock().unwrap().request("extract.cancel", json!({}));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
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
    not_impl(&format!("adv_capture({}, {})", args.path, args.frame))
}
