//! Cross-platform user prefs (`~/.vid2dataset.json`), shared with the legacy GUI.
//!
//! The file is a flat JSON object. Tauri only requires a small core surface
//! (`lang`, `input`, `output`, `preset`); extra keys written by the old UI
//! (e.g. `trigger_word`) are preserved on merge so both shells stay compatible.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

/// Resolve `~/.vid2dataset.json` on Windows (`USERPROFILE`) and Unix (`HOME`).
pub fn prefs_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".vid2dataset.json")
}

/// Load prefs. Missing or corrupt files yield an empty object (callers apply defaults).
pub fn load_prefs() -> Value {
    let path = prefs_path();
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => Value::Object(map),
            Ok(_) | Err(_) => Value::Object(Map::new()),
        },
        Err(_) => Value::Object(Map::new()),
    }
}

/// Merge `patch` into the existing prefs object and write it back.
///
/// Non-object patches are rejected. Existing unknown keys are kept so the
/// legacy CustomTkinter UI does not lose its extra fields.
pub fn save_prefs(patch: &Value) -> Result<Value, String> {
    let Value::Object(patch_map) = patch else {
        return Err("prefs must be a JSON object".into());
    };

    let mut current = match load_prefs() {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    for (key, value) in patch_map {
        if value.is_null() {
            current.remove(key);
        } else {
            current.insert(key.clone(), value.clone());
        }
    }

    let merged = Value::Object(current);
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create prefs dir: {e}"))?;
    }
    let text = serde_json::to_string_pretty(&merged)
        .map_err(|e| format!("cannot serialize prefs: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("cannot write prefs: {e}"))?;
    Ok(merged)
}

/// Language stored in prefs, defaulting to `"zh"` (new UI default).
pub fn load_lang() -> String {
    match load_prefs().get("lang").and_then(Value::as_str) {
        Some("en") => "en".into(),
        Some("zh") => "zh".into(),
        _ => "zh".into(),
    }
}

pub fn save_lang(lang: &str) -> Result<(), String> {
    if lang != "en" && lang != "zh" {
        return Err(format!("unsupported lang: {lang}"));
    }
    save_prefs(&json!({ "lang": lang }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize tests that touch the real prefs path via env override is hard
    // without a temp-home helper; these unit-test pure merge behaviour via a
    // private temp file by swapping HOME/USERPROFILE for the duration.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_home<F: FnOnce(PathBuf)>(f: F) {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!(
            "vid2dataset-prefs-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let prev_home = std::env::var_os("HOME");
        let prev_profile = std::env::var_os("USERPROFILE");
        // Clear both so prefs_path is deterministic, then set HOME (also used on Windows here).
        std::env::remove_var("USERPROFILE");
        std::env::set_var("HOME", &dir);

        f(dir.clone());

        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        match prev_profile {
            Some(v) => std::env::set_var("USERPROFILE", v),
            None => std::env::remove_var("USERPROFILE"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_prefs_merges_without_dropping_legacy_keys() {
        with_temp_home(|_dir| {
            save_prefs(&json!({
                "lang": "en",
                "input": "/videos",
                "trigger_word": "miku"
            }))
            .unwrap();

            let merged = save_prefs(&json!({
                "lang": "zh",
                "output": "/out"
            }))
            .unwrap();

            assert_eq!(merged["lang"], "zh");
            assert_eq!(merged["input"], "/videos");
            assert_eq!(merged["output"], "/out");
            assert_eq!(merged["trigger_word"], "miku");
        });
    }

    #[test]
    fn load_lang_defaults_to_zh() {
        with_temp_home(|_dir| {
            assert_eq!(load_lang(), "zh");
            save_lang("en").unwrap();
            assert_eq!(load_lang(), "en");
        });
    }

    #[test]
    fn null_patch_removes_key() {
        with_temp_home(|_dir| {
            save_prefs(&json!({ "input": "/a", "output": "/b" })).unwrap();
            let merged = save_prefs(&json!({ "input": null })).unwrap();
            assert!(merged.get("input").is_none());
            assert_eq!(merged["output"], "/b");
        });
    }
}
