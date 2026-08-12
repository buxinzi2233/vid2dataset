#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod commands;
mod state;

use std::sync::Mutex;

use tauri::{Emitter, Manager};

use bridge::Bridge;
use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawn the Python sidecar. Tauri event names cannot contain dots,
            // so bridge events use colons only at the webview boundary.
            let resource_dir = app.path().resource_dir().ok();
            let paths = bridge::default_sidecar_paths(resource_dir.as_deref());
            let bridge = Bridge::spawn(&paths, move |event_name, data| {
                let webview_event = event_name.replace('.', ":");
                let _ = handle.emit(&webview_event, data);
            })
            .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

            app.manage(AppState {
                bridge: Mutex::new(bridge),
                cancel_event_id: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_version,
            commands::get_lang,
            commands::set_lang,
            commands::get_prefs,
            commands::set_prefs,
            commands::browse_folder,
            commands::list_presets,
            commands::load_preset,
            commands::config_defaults,
            commands::config_validate,
            commands::discover_videos,
            commands::probe_video,
            commands::start_run,
            commands::cancel_run,
            commands::adv_open,
            commands::adv_seek,
            commands::adv_capture,
            commands::adv_segments,
            commands::tagger_status,
            commands::tagger_download,
            commands::tagger_run,
            commands::gpu_detect,
            commands::gpu_status,
            commands::gpu_download,
            commands::check_update,
            commands::install_update,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
