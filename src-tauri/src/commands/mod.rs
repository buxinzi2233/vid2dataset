//! Tauri commands — the typed IPC surface exposed to the frontend.
//!
//! Modules are grouped by domain (config / extract / runtime / system) to keep
//! the surface small and cohesive. Each command either forwards to the bridge
//! or performs a local action (prefs file, folder dialog, version string).
//!
//! Contract reference: `docs/api-contract.md` §3.

pub mod config;
pub mod extract;
pub mod runtime;
pub mod system;

pub use config::*;
pub use extract::*;
pub use runtime::*;
pub use system::*;
