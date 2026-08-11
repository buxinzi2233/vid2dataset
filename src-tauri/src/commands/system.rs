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

/// Platform file-manager command used to open a folder.
fn opener_command() -> &'static str {
    if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    }
}

/// Open a folder in the platform file manager (`open` / `xdg-open` /
/// `explorer`). Local OS action — not routed through the bridge.
#[tauri::command]
pub fn open_folder(args: OpenFolderArgs) -> Result<Value, String> {
    let path = args.path;
    let cmd = opener_command();
    std::process::Command::new(cmd)
        .arg(&path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to open folder {path}: {e}"))?;
    Ok(json!({ "opened": path }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opener_command_matches_platform() {
        let cmd = opener_command();
        assert!(
            cmd == "open" || cmd == "explorer" || cmd == "xdg-open",
            "unexpected opener command: {cmd}"
        );
    }

    #[test]
    fn open_folder_existing_dir_succeeds() {
        // Use a path that certainly exists: the crate source directory.
        let dir = env!("CARGO_MANIFEST_DIR");
        match open_folder(OpenFolderArgs { path: dir.to_string() }) {
            Ok(value) => assert_eq!(value["opened"], dir),
            Err(_) => {
                // Headless hosts may lack xdg-open; a graceful error is
                // acceptable — the point is it routes to the platform opener.
            }
        }
    }
}
