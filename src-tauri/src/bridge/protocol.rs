//! NDJSON protocol frames shared between the Rust shell and the Python sidecar.
//!
//! See `docs/api-contract.md` §1 for the full protocol description.
//! Each frame is a single JSON object on its own line over stdin/stdout.

#![allow(dead_code)] // Response::ok/err are used by the feature tasks, not yet the stubs.

use serde::{Deserialize, Serialize};

/// A request sent from Rust to the Python sidecar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// A successful response frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorInfo>,
}

/// Structured error carried in a failed response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
}

/// An unsolicited event pushed from the sidecar (no `id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event: String,
    pub data: serde_json::Value,
}

/// Any frame the sidecar may emit on stdout.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Incoming {
    Response(Response),
    Event(Event),
}

impl Incoming {
    /// Distinguish a response (has an `id`) from an event.
    pub fn from_line(line: &str) -> Result<Incoming, serde_json::Error> {
        let value: serde_json::Value = serde_json::from_str(line)?;
        if value.get("id").is_some() {
            serde_json::from_value::<Response>(value).map(Incoming::Response)
        } else {
            serde_json::from_value::<Event>(value).map(Incoming::Event)
        }
    }
}

impl Response {
    pub fn ok(id: u64, result: serde_json::Value) -> Self {
        Self { id, ok: true, result: Some(result), error: None }
    }

    pub fn err(id: u64, code: &str, message: &str) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(ErrorInfo { code: code.to_string(), message: message.to_string() }),
        }
    }
}
