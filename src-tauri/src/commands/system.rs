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

/// Structured error surfaced to the frontend as `{ code, message }`.
#[derive(Debug, serde::Serialize)]
pub struct OpenFolderError {
    pub code: String,
    pub message: String,
}

impl OpenFolderError {
    fn new(code: &str, message: String) -> Self {
        Self { code: code.to_string(), message }
    }
}

impl std::fmt::Display for OpenFolderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for OpenFolderError {}

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

/// Validate the path exists, is a directory, and is readable (permission probe).
fn validate_folder(path: &std::path::Path) -> Result<(), OpenFolderError> {
    if !path.exists() {
        return Err(OpenFolderError::new(
            "PATH_NOT_FOUND",
            format!("Folder does not exist: {}", path.display()),
        ));
    }
    if !path.is_dir() {
        return Err(OpenFolderError::new(
            "NOT_A_DIRECTORY",
            format!("Not a directory: {}", path.display()),
        ));
    }
    // Readiness probe: an unreadable dir makes the file manager open an empty
    // or error view; reject it up front with a friendly message.
    if std::fs::read_dir(path).is_err() {
        return Err(OpenFolderError::new(
            "PERMISSION_DENIED",
            format!("Cannot open folder (permission denied): {}", path.display()),
        ));
    }
    Ok(())
}

/// Open a folder in the platform file manager (`open` / `xdg-open` /
/// `explorer`). Local OS action — not routed through the bridge.
#[tauri::command]
pub fn open_folder(args: OpenFolderArgs) -> Result<Value, OpenFolderError> {
    let path = std::path::PathBuf::from(&args.path);
    validate_folder(&path)?;

    let cmd = opener_command();
    std::process::Command::new(cmd)
        .arg(&path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            OpenFolderError::new(
                "OPEN_FAILED",
                format!("Failed to launch the file manager for {}: {e}", path.display()),
            )
        })?;
    Ok(json!({ "opened": path.display().to_string() }))
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
    fn validate_folder_rejects_missing_path() {
        let missing = std::env::temp_dir().join("vid2dataset-nonexistent-xyz");
        let err = validate_folder(&missing).unwrap_err();
        assert_eq!(err.code, "PATH_NOT_FOUND");
    }

    #[test]
    fn validate_folder_rejects_file() {
        let file = std::env::temp_dir().join("vid2dataset-notadir-xyz");
        std::fs::write(&file, b"x").unwrap();
        let err = validate_folder(&file).unwrap_err();
        assert_eq!(err.code, "NOT_A_DIRECTORY");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn validate_folder_accepts_existing_dir() {
        let dir = std::env::temp_dir().join("vid2dataset-okdir-xyz");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(validate_folder(&dir).is_ok());
        let _ = std::fs::remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn validate_folder_rejects_unreadable_dir() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join("vid2dataset-noread-xyz");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o000)).unwrap();
        // Root bypasses mode bits; in that case read_dir still succeeds, so
        // there is no permission error to assert — treat as pass.
        let outcome = std::fs::read_dir(&dir).map(|_| "readable").map_err(|_| "blocked");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        let _ = std::fs::remove_dir(&dir);
        if outcome == Ok("blocked") {
            let err = validate_folder(&dir).unwrap_err();
            assert_eq!(err.code, "PERMISSION_DENIED");
        }
    }

    #[test]
    fn open_folder_existing_dir_succeeds() {
        // Use a path that certainly exists: the crate source directory.
        let dir = env!("CARGO_MANIFEST_DIR");
        match open_folder(OpenFolderArgs { path: dir.to_string() }) {
            Ok(value) => assert_eq!(value["opened"], dir),
            Err(e) => {
                // Headless hosts may lack xdg-open; a graceful error is
                // acceptable — the point is it routes to the platform opener.
                assert_eq!(e.code, "OPEN_FAILED");
            }
        }
    }
}
