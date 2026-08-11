//! extract domain commands: source discovery, probe, run, cancel, advanced.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

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
pub fn adv_open(args: PathArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("advanced.open", json!({ "path": args.path }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvSeekArgs {
    pub path: String,
    pub frame: u64,
}

#[tauri::command]
pub fn adv_seek(args: AdvSeekArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("advanced.seek", json!({ "path": args.path, "frame": args.frame }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvCaptureArgs {
    pub path: String,
    pub frame: u64,
    pub config: Value,
}

#[tauri::command]
pub fn adv_capture(args: AdvCaptureArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request(
            "advanced.capture",
            json!({ "path": args.path, "frame": args.frame, "config": args.config }),
        );
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvSegmentsArgs {
    pub segments: Value,
}

#[tauri::command]
pub fn adv_segments(args: AdvSegmentsArgs, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state
        .bridge
        .lock()
        .unwrap()
        .request("advanced.segments", json!({ "segments": args.segments }));
    if result.ok {
        Ok(result.result)
    } else {
        let e = result.error.unwrap_or_default();
        Err(format!("{}: {}", e.code, e.message))
    }
}
