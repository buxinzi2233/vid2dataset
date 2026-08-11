//! BridgeManager: owns the Python sidecar subprocess and routes NDJSON
//! frames between Rust commands and the sidecar.
//!
//! - `request(method, params)` writes a frame to stdin and awaits the matching
//!   response via a oneshot channel keyed by `id`.
//! - A reader thread consumes stdout, resolving pending requests and calling
//!   back on unsolicited events.
//!
//! Scaffold note: `child`/`shutdown` are wired but not yet exercised until the
//! feature commands land, hence the module-level dead-code allowance.

#![allow(dead_code)]

pub mod protocol;

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use protocol::{Incoming, Request, Response};

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Response>>>>;

/// Result of a bridge request as seen by the command layer.
#[derive(Debug)]
pub struct BridgeResult {
    pub ok: bool,
    pub result: serde_json::Value,
    pub error: Option<protocol::ErrorInfo>,
}

/// Owns the sidecar child process and its read loop.
pub struct Bridge {
    child: std::process::Child,
    stdin: Option<std::process::ChildStdin>,
    pending: PendingMap,
    next_id: std::sync::atomic::AtomicU64,
    pub alive: Arc<std::sync::atomic::AtomicBool>,
}

impl Bridge {
    /// Spawn the sidecar and start the stdout reader thread.
    ///
    /// `event_cb` is invoked on the reader thread for every unsolicited event
    /// (e.g. `extract.progress`); the caller decides how to forward it to the
    /// webview. Must be Send + Sync.
    pub fn spawn<F>(python: &str, script: &str, event_cb: F) -> std::io::Result<Bridge>
    where
        F: Fn(&str, serde_json::Value) + Send + Sync + 'static,
    {
        let mut child = std::process::Command::new(python)
            .args(["-u", script])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::Other, "no stdout on sidecar")
        })?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let bridge = Bridge {
            child,
            stdin,
            pending: Arc::clone(&pending),
            next_id: std::sync::atomic::AtomicU64::new(1),
            alive: Arc::new(std::sync::atomic::AtomicBool::new(true)),
        };

        // Reader thread: resolve pending requests, dispatch events.
        let alive = Arc::clone(&bridge.alive);
        thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let Ok(frame) = Incoming::from_line(&line) else {
                    continue;
                };
                match frame {
                    Incoming::Response(resp) => {
                        if let Some(tx) = pending.lock().unwrap().remove(&resp.id) {
                            let _ = tx.send(resp);
                        }
                    }
                    Incoming::Event(ev) => event_cb(&ev.event, ev.data),
                }
            }
            alive.store(false, std::sync::atomic::Ordering::SeqCst);
        });

        Ok(bridge)
    }

    /// Send a request and block until the matching response arrives (or the
    /// bridge dies). Events emitted meanwhile are forwarded by the reader.
    pub fn request(&mut self, method: &str, params: serde_json::Value) -> BridgeResult {
        if !self.alive.load(std::sync::atomic::Ordering::SeqCst) {
            return BridgeResult {
                ok: false,
                result: serde_json::Value::Null,
                error: Some(protocol::ErrorInfo {
                    code: "BRIDGE_DOWN".into(),
                    message: "sidecar is not running".into(),
                }),
            };
        }

        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let (tx, rx) = mpsc::channel::<Response>();
        self.pending.lock().unwrap().insert(id, tx);

        let frame = Request { id, method: method.into(), params };
        let line = serde_json::to_string(&frame).unwrap_or_default();
        let write_ok = match self.stdin.as_mut() {
            Some(stdin) => writeln!(stdin, "{line}").and_then(|_| stdin.flush()).is_ok(),
            None => false,
        };

        if !write_ok {
            self.pending.lock().unwrap().remove(&id);
            return BridgeResult {
                ok: false,
                result: serde_json::Value::Null,
                error: Some(protocol::ErrorInfo {
                    code: "BRIDGE_DOWN".into(),
                    message: "failed to write to sidecar".into(),
                }),
            };
        }

        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(resp) => BridgeResult {
                ok: resp.ok,
                result: resp.result.unwrap_or(serde_json::Value::Null),
                error: resp.error,
            },
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                BridgeResult {
                    ok: false,
                    result: serde_json::Value::Null,
                    error: Some(protocol::ErrorInfo {
                        code: "TIMEOUT".into(),
                        message: "sidecar did not respond".into(),
                    }),
                }
            }
        }
    }

    /// Best-effort kill of the sidecar.
    pub fn shutdown(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Resolve the repo-relative sidecar path. In dev this is `bridge/main.py`;
/// packaged builds will bundle the script elsewhere (future work).
pub fn default_sidecar_paths() -> (String, String) {
    ("venv/bin/python".to_string(), "bridge/main.py".to_string())
}
