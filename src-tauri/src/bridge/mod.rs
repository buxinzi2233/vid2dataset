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
use std::ffi::OsString;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
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

#[derive(Debug, Clone)]
pub struct SidecarPaths {
    pub python: PathBuf,
    pub script: PathBuf,
    python_home: Option<PathBuf>,
    python_path: Option<PathBuf>,
}

impl SidecarPaths {
    fn bundled(resource_dir: &Path) -> Option<Self> {
        let runtime = resource_dir.join("runtime/python");
        let mut interpreters = std::fs::read_dir(runtime.join("bin"))
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with("python3."))
            })
            .collect::<Vec<_>>();
        interpreters.sort();
        let python = interpreters.pop()?;
        let script = resource_dir.join("bridge/main.py");
        let python_path = resource_dir.join("python");
        if python.is_file() && script.is_file() && python_path.is_dir() {
            Some(Self {
                python,
                script,
                python_home: Some(runtime),
                python_path: Some(python_path),
            })
        } else {
            None
        }
    }

    fn repository() -> Self {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri must live inside the repository");
        Self {
            python: repo_root.join("venv/bin/python"),
            script: repo_root.join("bridge/main.py"),
            python_home: None,
            python_path: None,
        }
    }

    fn overrides(python: OsString, script: OsString) -> Self {
        Self {
            python: PathBuf::from(python),
            script: PathBuf::from(script),
            python_home: None,
            python_path: None,
        }
    }

    fn apply_environment(&self, command: &mut std::process::Command) {
        command.env("PYTHONDONTWRITEBYTECODE", "1");
        command.env("PYTHONNOUSERSITE", "1");
        if let Some(home) = &self.python_home {
            command.env("PYTHONHOME", home);
            #[cfg(target_os = "linux")]
            {
                let bundled_lib = home.join("lib");
                let mut paths = vec![bundled_lib.clone()];
                if let Ok(entries) = std::fs::read_dir(&bundled_lib) {
                    for version_dir in entries.filter_map(Result::ok).map(|entry| entry.path()) {
                        let site_packages = version_dir.join("site-packages");
                        let Ok(packages) = std::fs::read_dir(site_packages) else {
                            continue;
                        };
                        paths.extend(
                            packages
                                .filter_map(Result::ok)
                                .map(|entry| entry.path())
                                .filter(|path| {
                                    path.is_dir()
                                        && path
                                            .file_name()
                                            .and_then(|name| name.to_str())
                                            .is_some_and(|name| name.ends_with(".libs"))
                                }),
                        );
                    }
                }
                if let Some(existing) = std::env::var_os("LD_LIBRARY_PATH") {
                    paths.extend(std::env::split_paths(&existing));
                }
                if let Ok(value) = std::env::join_paths(paths) {
                    command.env("LD_LIBRARY_PATH", value);
                }
            }
        }
        if let Some(path) = &self.python_path {
            command.env("PYTHONPATH", path);
        }
    }
}

impl Bridge {
    /// Spawn the sidecar and start the stdout reader thread.
    ///
    /// `event_cb` is invoked on the reader thread for every unsolicited event
    /// (e.g. `extract.progress`); the caller decides how to forward it to the
    /// webview. Must be Send + Sync.
    pub fn spawn<F>(paths: &SidecarPaths, event_cb: F) -> std::io::Result<Bridge>
    where
        F: Fn(&str, serde_json::Value) + Send + Sync + 'static,
    {
        let mut command = std::process::Command::new(&paths.python);
        command.args([OsString::from("-u"), paths.script.clone().into_os_string()]);
        paths.apply_environment(&mut command);
        let mut child = command
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

        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let (tx, rx) = mpsc::channel::<Response>();
        self.pending.lock().unwrap().insert(id, tx);

        let frame = Request {
            id,
            method: method.into(),
            params,
        };
        let line = serde_json::to_string(&frame).unwrap_or_default();
        let write_ok = match self.stdin.as_mut() {
            Some(stdin) => writeln!(stdin, "{line}")
                .and_then(|_| stdin.flush())
                .is_ok(),
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

/// Resolve the sidecar paths independently of the process working directory.
/// Packaged builds can override both locations through environment variables.
pub fn default_sidecar_paths(resource_dir: Option<&Path>) -> SidecarPaths {
    if let (Some(python), Some(script)) = (
        std::env::var_os("VID2DATASET_PYTHON"),
        std::env::var_os("VID2DATASET_BRIDGE_SCRIPT"),
    ) {
        return SidecarPaths::overrides(python, script);
    }
    if let Some(resource_dir) = std::env::var_os("VID2DATASET_RESOURCE_DIR") {
        if let Some(paths) = SidecarPaths::bundled(Path::new(&resource_dir)) {
            return paths;
        }
    }
    resource_dir
        .and_then(SidecarPaths::bundled)
        .unwrap_or_else(SidecarPaths::repository)
}

#[cfg(test)]
mod tests {
    use super::default_sidecar_paths;
    use std::fs;

    #[test]
    fn default_sidecar_paths_are_absolute_and_exist() {
        let paths = default_sidecar_paths(None);
        assert!(paths.python.is_absolute());
        assert!(paths.script.is_absolute());
        assert!(paths.python.is_file());
        assert!(paths.script.is_file());
    }

    #[test]
    fn bundled_sidecar_paths_prefer_the_resource_directory() {
        let root =
            std::env::temp_dir().join(format!("vid2dataset-sidecar-paths-{}", std::process::id()));
        let python = root.join("runtime/python/bin/python3.12");
        let script = root.join("bridge/main.py");
        let package = root.join("python/vid2dataset");
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::create_dir_all(script.parent().unwrap()).unwrap();
        fs::create_dir_all(&package).unwrap();
        fs::write(&python, "").unwrap();
        fs::write(&script, "").unwrap();

        let paths = default_sidecar_paths(Some(&root));
        assert_eq!(paths.python, python);
        assert_eq!(paths.script, script);
        assert_eq!(paths.python_home, Some(root.join("runtime/python")));
        assert_eq!(paths.python_path, Some(root.join("python")));

        fs::remove_dir_all(root).unwrap();
    }
}
