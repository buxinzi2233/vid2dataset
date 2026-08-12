//! Application state managed by Tauri.
//!
//! Kept intentionally thin: the Rust shell is a forwarding layer, not a
//! business-logic holder. Business config lives in the frontend store.

#![allow(dead_code)] // cancel_event_id is populated by the start_run/cancel feature task.

use std::sync::Mutex;

use crate::bridge::Bridge;

pub struct AppState {
    /// Mutex over the sidecar so writes are serialized.
    pub bridge: Mutex<Bridge>,
    /// Running extraction's cancel request id, if any.
    pub cancel_event_id: Mutex<Option<u64>>,
}
