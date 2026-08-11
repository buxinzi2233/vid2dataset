"""NDJSON sidecar for the Tauri shell.

Reads NDJSON requests from stdin, dispatches to the ``METHODS`` registry,
writes NDJSON responses/events to stdout. stdout carries ONLY protocol
frames; Python logging goes to stderr.

Protocol (see docs/api-contract.md §1):
    request : {"id": u64, "method": str, "params": object}
    response: {"id": u64, "ok": bool, "result"|"error": ...}
    event   : {"event": str, "data": object}

Long-running methods (extract.run) execute on a worker thread so the read
loop can keep consuming stdin (e.g. extract.cancel) and pushing events.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
from collections.abc import Callable

from vid2dataset.config import ExtractConfig
from vid2dataset.extractor import run_pipeline
from vid2dataset.io_utils import discover_videos, probe_video
from vid2dataset.presets import list_presets

log = logging.getLogger("bridge")

# ── Extract runtime state ───────────────────────────────────────────────
# Shared between extract.run (worker) and extract.cancel (reader thread).
_cancel_event: threading.Event | None = None
_run_lock = threading.Lock()


# ── Method handlers ─────────────────────────────────────────────────────


def _not_impl(name: str) -> None:
    raise NotImplementedError(name)


def _presets(_params: dict) -> list[dict]:
    return [{"name": n, "description": d} for n, d in list_presets()]


def _config_defaults(_params: dict) -> dict:
    return ExtractConfig.model_json_schema()["properties"]


def _source_discover(params: dict) -> list[str]:
    from pathlib import Path

    return [str(p) for p in discover_videos(Path(params["path"]))]


def _source_probe(params: dict) -> dict:
    from pathlib import Path

    meta = probe_video(Path(params["path"]))
    return {
        "path": str(meta.path),
        "fps": meta.fps,
        "frame_count": meta.frame_count,
        "width": meta.width,
        "height": meta.height,
        "duration_s": meta.duration_s,
    }


class _LogHandler(logging.Handler):
    """Forward Python logging lines from the pipeline as extract.log events."""

    def emit(self, record: logging.LogRecord) -> None:
        _write({"event": "extract.log", "data": {"line": self.format(record)}})


def _extract_run(params: dict) -> dict:
    """Start extraction on a worker thread; returns immediately.

    The worker runs ``run_pipeline``, streaming ``extract.progress`` /
    ``extract.log`` events, and finishes by emitting ``extract.done`` with the
    summary. This method itself is synchronous-only in the registry sense: it
    spawns the worker and returns ``{"started": true}`` so the caller's request
    resolves fast, while the actual completion arrives via ``extract.done``.
    """
    cfg = ExtractConfig(**params["config"])

    # Only one run at a time; reject a concurrent start.
    if not _run_lock.acquire(blocking=False):
        raise RuntimeError("an extraction is already running")

    cancel = threading.Event()
    global _cancel_event
    _cancel_event = cancel

    def _worker() -> None:
        try:
            def progress_cb(stage: str, current: int, total: int) -> None:
                _write({"event": "extract.progress",
                        "data": {"stage": stage, "current": current, "total": total}})
            handler = _LogHandler()
            handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
            logging.getLogger().addHandler(handler)
            try:
                result = run_pipeline(cfg, progress=progress_cb, cancel_event=cancel)
            finally:
                logging.getLogger().removeHandler(handler)
            _write({"event": "extract.done", "data": result.to_summary_dict()})
        except Exception as e:  # noqa: BLE001 - surfaced as an event
            _write({"event": "extract.error", "data": {"message": str(e)}})
        finally:
            _run_lock.release()

    threading.Thread(target=_worker, daemon=True).start()
    return {"started": True}


def _extract_cancel(_params: dict) -> dict:
    global _cancel_event
    ev = _cancel_event
    if ev is not None:
        ev.set()
    return {"cancelled": ev is not None}


METHODS: dict[str, Callable[[dict], object]] = {
    "config.defaults": _config_defaults,
    "config.validate": lambda p: _not_impl("config.validate"),
    "presets.list": _presets,
    "presets.load": lambda p: _not_impl("presets.load"),
    "source.discover": _source_discover,
    "source.probe": _source_probe,
    "extract.run": _extract_run,
    "extract.cancel": _extract_cancel,
    "tagger.status": lambda p: _not_impl("tagger.status"),
    "tagger.download": lambda p: _not_impl("tagger.download"),
    "tagger.run": lambda p: _not_impl("tagger.run"),
    "gpu.detect": lambda p: _not_impl("gpu.detect"),
    "gpu.status": lambda p: _not_impl("gpu.status"),
    "gpu.download": lambda p: _not_impl("gpu.download"),
    "update.check": lambda p: _not_impl("update.check"),
    "update.install": lambda p: _not_impl("update.install"),
    "advanced.open": lambda p: _not_impl("advanced.open"),
    "advanced.seek": lambda p: _not_impl("advanced.seek"),
    "advanced.capture": lambda p: _not_impl("advanced.capture"),
    "advanced.segments": lambda p: _not_impl("advanced.segments"),
}


# ── Dispatch ────────────────────────────────────────────────────────────


def _write(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _dispatch(req: dict) -> None:
    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params") or {}

    if not isinstance(req_id, int) or not isinstance(method, str):
        _write({"id": req_id, "ok": False,
                "error": {"code": "VALIDATION", "message": "bad frame"}})
        return

    fn = METHODS.get(method)
    if fn is None:
        _write({"id": req_id, "ok": False,
                "error": {"code": "VALIDATION", "message": f"unknown method {method}"}})
        return

    try:
        result = fn(params)
    except NotImplementedError as e:
        _write({"id": req_id, "ok": False,
                "error": {"code": "NotImplemented", "message": str(e)}})
    except Exception as e:  # noqa: BLE001 - surfaced to the shell
        _write({"id": req_id, "ok": False,
                "error": {"code": type(e).__name__, "message": str(e)}})
    else:
        _write({"id": req_id, "ok": True, "result": result})


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _write({"id": None, "ok": False,
                    "error": {"code": "VALIDATION", "message": f"bad json: {e}"}})
            continue
        threading.Thread(target=_dispatch, args=(req,), daemon=True).start()


if __name__ == "__main__":
    main()
