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
from vid2dataset.presets import list_preset_info

log = logging.getLogger("bridge")

# ── Extract runtime state ───────────────────────────────────────────────
# Shared between extract.run (worker) and extract.cancel (reader thread).
_cancel_event: threading.Event | None = None
_run_lock = threading.Lock()
_gpu_download_lock = threading.Lock()
_gpu_download_active = False


# ── Method handlers ─────────────────────────────────────────────────────


def _presets(_params: dict) -> list[dict]:
    return [
        {"name": name, "description": description, "user": user}
        for name, description, user in list_preset_info()
    ]


def _preset_load(params: dict) -> dict:
    from vid2dataset.presets import load_preset

    return load_preset(params["name"])


def _preset_save(params: dict) -> dict:
    from vid2dataset.presets import save_preset

    name, path = save_preset(
        params["name"],
        params.get("description", ""),
        params.get("config", {}),
    )
    return {
        "name": name,
        "description": params.get("description", "").strip(),
        "user": True,
        "path": str(path),
    }


def _config_defaults(_params: dict) -> dict:
    return ExtractConfig.model_json_schema()["properties"]


def _config_validate(params: dict) -> dict:
    from pydantic import ValidationError

    try:
        ExtractConfig(**params["config"])
    except ValidationError as e:
        return {
            "valid": False,
            "errors": [
                {"field": ".".join(str(x) for x in err["loc"]), "message": err["msg"]}
                for err in e.errors()
            ],
        }
    return {"valid": True, "errors": []}


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


def _pipeline_summary(result: object) -> dict:
    """Return the compact, fully typed result consumed by the Tauri UI."""
    return {
        "total_written": result.total_written,
        "total_candidates": result.total_candidates,
        "elapsed_s": round(result.elapsed_s, 2),
        "contact_sheet": result.contact_sheet_path,
        "html_gallery": result.html_gallery_path,
        "tagging": result.tagging,
        "videos": [
            {
                "video": stats.video,
                "duration_s": stats.duration_s,
                "fps": stats.fps,
                "width": stats.width,
                "height": stats.height,
                "scenes": stats.scenes,
                "candidates": stats.candidates,
                "written": stats.written,
                "rejected_blur": stats.rejected_blur,
                "rejected_luma": stats.rejected_luma,
                "rejected_too_small": stats.rejected_too_small,
                "rejected_dup": stats.rejected_dup,
                "rejected_ssim": stats.rejected_ssim,
                "rejected_color": stats.rejected_color,
                "rejected_completeness": stats.rejected_completeness,
                "auto_blur_threshold": stats.auto_blur_threshold,
                "elapsed_s": round(stats.elapsed_s, 2),
                "watermarks": stats.watermarks,
            }
            for stats in result.videos
        ],
    }


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
            _write({"event": "extract.done", "data": _pipeline_summary(result)})
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


def _tagger_status(params: dict) -> dict:
    from vid2dataset.tagger import download_size_mb, model_status

    model = params["model"]
    available, _dir = model_status(model)
    return {"available": available, "size_mb": download_size_mb(model)}


def _tagger_run(params: dict) -> dict:
    """Tag a folder of images on a worker thread.

    Returns immediately with ``{"started": true}``. Progress streams via
    ``extract.progress`` with ``stage="tag:tagging"``; completion via a
    ``tagger.done`` event carrying the TagSummary.
    """
    from vid2dataset.tagger import TagSummary, tag_folder

    folder = params["folder"]

    def progress_cb(stage: str, done: int, total: int) -> None:
        if stage == "tagging":
            _write({"event": "extract.progress",
                    "data": {"stage": "tag:tagging", "current": done, "total": total}})
        elif total > 0:  # download progress (bytes)
            _write({"event": "download.progress",
                    "data": {"pkg": stage, "current": done, "total": total}})

    def _summary_dict(s: TagSummary) -> dict:
        return {
            "tagged": s.tagged,
            "failed": s.failed,
            "total": s.total,
            "cancelled": s.cancelled,
            "rejected": s.rejected,
            "pruned_tags": s.pruned_tags,
            "tag_counts": dict(s.tag_counts),
            "per_image": s.per_image,
        }

    def _worker() -> None:
        try:
            summary = tag_folder(
                folder,
                model_name=params.get("model_name", "wd-eva02-large-tagger-v3"),
                trigger_word=params.get("trigger_word", ""),
                general_threshold=params.get("general_threshold", 0.35),
                character_threshold=params.get("character_threshold", 0.85),
                blacklist=params.get("blacklist", ""),
                always=params.get("always", ""),
                trait_prune_threshold=params.get("trait_prune_threshold", 0.0),
                require=params.get("require", ""),
                exclude=params.get("exclude", ""),
                use_gpu=params.get("use_gpu", True),
                progress_cb=progress_cb,
            )
            _write({"event": "tagger.done", "data": _summary_dict(summary)})
        except Exception as e:  # noqa: BLE001 - surfaced as an event
            _write({"event": "tagger.done", "data": {"error": str(e)}})

    threading.Thread(target=_worker, daemon=True).start()
    return {"started": True}


def _tagger_download(params: dict) -> dict:
    """Ensure onnxruntime + download the model on a worker thread.

    Returns immediately with ``{"started": true}``. Progress streams via
    ``download.progress`` ({pkg, current, total}); completion via
    ``download.done`` ({kind: "tagger", error?}).
    """
    from vid2dataset.tagger import TAGGER_MODELS

    model = params["model"]
    if model not in TAGGER_MODELS:
        raise ValueError(f"Unknown tagger model: {model}. Available: {list(TAGGER_MODELS)}")

    def progress_cb(pkg: str, done: int, total: int) -> None:
        _write({"event": "download.progress",
                "data": {"pkg": pkg, "current": done, "total": total}})

    def _worker() -> None:
        try:
            from vid2dataset import tagger_runtime
            from vid2dataset.tagger import download_model, model_status

            tagger_runtime.ensure_onnxruntime(progress=progress_cb)
            ok, _ = model_status(model)
            if not ok:
                download_model(model, progress=progress_cb)
            _write({"event": "download.done", "data": {"kind": "tagger"}})
        except Exception as e:  # noqa: BLE001 - surfaced as an event
            _write({"event": "download.done",
                    "data": {"kind": "tagger", "error": str(e)}})

    threading.Thread(target=_worker, daemon=True).start()
    return {"started": True}


def _gpu_detect(_params: dict) -> dict:
    from vid2dataset.gpu_runtime import detect_gpu

    hw = detect_gpu()
    return {
        "vendor": hw.vendor,
        "gpu_name": hw.gpu_name,
        "arch": hw.arch,
        "compute_cap": hw.compute_cap,
        "os_name": hw.os_name,
        "os_arch": hw.os_arch,
    }


def _gpu_status(_params: dict) -> dict:
    from vid2dataset.gpu_runtime import runtime_status

    st = runtime_status()
    return {
        "available": st.available,
        "cached": st.cached,
        "version": st.version,
        "cache_dir": str(st.cache_dir),
        "size_mb": st.size_mb,
        "cuda_tag": st.cuda_tag,
        "error": st.error,
        "can_download": st.can_download,
    }


def _gpu_download(_params: dict) -> dict:
    """Download the GPU runtime on a worker thread.

    Returns immediately with ``{"started": true}``. Progress streams via
    ``download.progress`` ({pkg, current, total}); completion via
    ``download.done`` ({kind: "gpu", error?}).
    """
    from vid2dataset.gpu_runtime import activate_runtime, download_runtime, runtime_status

    global _gpu_download_active

    with _gpu_download_lock:
        if _gpu_download_active:
            return {"started": False, "downloading": True}

        status = runtime_status()
        if status.available:
            return {"started": False, "available": True}
        if not status.can_download:
            raise RuntimeError(status.error or "Automatic GPU runtime download is unavailable")
        _gpu_download_active = True

    def progress_cb(pkg: str, done: int, total: int) -> None:
        _write({"event": "download.progress",
                "data": {"pkg": pkg, "current": done, "total": total}})

    def _worker() -> None:
        try:
            download_runtime(progress=progress_cb)
            ok, error = activate_runtime()
            if not ok:
                raise RuntimeError(error)
            _write({"event": "download.done", "data": {"kind": "gpu"}})
        except Exception as e:  # noqa: BLE001 - surfaced as an event
            _write({"event": "download.done", "data": {"kind": "gpu", "error": str(e)}})
        finally:
            global _gpu_download_active
            with _gpu_download_lock:
                _gpu_download_active = False

    try:
        threading.Thread(target=_worker, daemon=True).start()
    except Exception:
        with _gpu_download_lock:
            _gpu_download_active = False
        raise
    return {"started": True}


def _update_check(_params: dict) -> dict:
    """Check for a newer release. Returns ReleaseInfo dict or ``None`` (up-to-date)."""
    from vid2dataset.updater import fetch_latest_release

    rel = fetch_latest_release()
    if rel is None:
        return {"available": False}
    return {
        "available": True,
        "tag": rel.tag,
        "version": rel.version,
        "name": rel.name,
        "notes": rel.notes,
        "exe_url": rel.exe_url,
        "exe_size": rel.exe_size,
    }


def _update_install(_params: dict) -> dict:
    """Stage the latest release.

    Only performs a real install when running from the packaged .exe; in dev
    mode it reports ``reason="not-exe"`` without touching anything.
    """
    import sys
    from pathlib import Path

    from vid2dataset.updater import (
        download_exe,
        fetch_latest_release,
        install_update,
        is_newer,
        is_running_as_exe,
    )

    rel = fetch_latest_release()
    if rel is None:
        return {"installed": False, "reason": "no-release"}
    if rel.exe_url is None or not is_newer(rel.version):
        return {"installed": False, "reason": "up-to-date"}
    if not is_running_as_exe():
        return {"installed": False, "reason": "not-exe"}

    target = Path(sys.executable).parent / "vid2dataset_new.exe"
    download_exe(rel.exe_url, target)
    install_update(target)
    return {"installed": True}


def _advanced_open(params: dict) -> dict:
    from pathlib import Path

    from vid2dataset.io_utils import probe_video

    meta = probe_video(Path(params["path"]))
    return {
        "path": str(meta.path),
        "fps": meta.fps,
        "frame_count": meta.frame_count,
        "width": meta.width,
        "height": meta.height,
        "duration_s": meta.duration_s,
    }


def _advanced_seek(params: dict) -> dict:
    import base64
    from pathlib import Path

    import cv2

    from vid2dataset.io_utils import open_capture

    path = Path(params["path"])
    frame_idx = int(params["frame"])
    with open_capture(path) as cap:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
    if not ok or frame is None:
        raise RuntimeError(f"could not read frame {frame_idx} from {path.name}")
    ok, buf = cv2.imencode(".jpg", frame)
    if not ok:
        raise RuntimeError("could not encode frame as JPEG")
    return {"frame_b64": base64.b64encode(buf.tobytes()).decode("ascii")}


def _advanced_capture(params: dict) -> dict:
    from pathlib import Path

    import cv2

    from vid2dataset.extractor import _output_dir_for, process_single_frame
    from vid2dataset.io_utils import open_capture, sanitize_stem

    cfg = ExtractConfig(**params["config"])
    path = Path(params["path"])
    frame_idx = int(params["frame"])

    with open_capture(path) as cap:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
    if not ok or frame is None:
        raise RuntimeError(f"could not read frame {frame_idx} from {path.name}")

    out_dir = _output_dir_for(cfg, path)
    prefix = f"{sanitize_stem(path.stem)}_manual_"
    seq = 1
    if out_dir.exists():
        seq = max(
            (
                int(p.stem[len(prefix):])
                for p in out_dir.glob(f"{prefix}*")
                if p.stem[len(prefix):].isdigit()
            ),
            default=0,
        ) + 1

    out_path = process_single_frame(cfg, frame, path, seq)
    if out_path is None:
        raise RuntimeError("could not process frame")
    return {"out_path": str(out_path)}


# Advanced-mode segments are applied on the next extract.run via the config
# dict; this method just acknowledges the handoff (kept for contract parity).
def _advanced_segments(params: dict) -> dict:
    _ = params.get("segments")
    return {"saved": True}


METHODS: dict[str, Callable[[dict], object]] = {
    "config.defaults": _config_defaults,
    "config.validate": _config_validate,
    "presets.list": _presets,
    "presets.load": _preset_load,
    "presets.save": _preset_save,
    "source.discover": _source_discover,
    "source.probe": _source_probe,
    "extract.run": _extract_run,
    "extract.cancel": _extract_cancel,
    "tagger.status": _tagger_status,
    "tagger.download": _tagger_download,
    "tagger.run": _tagger_run,
    "gpu.detect": _gpu_detect,
    "gpu.status": _gpu_status,
    "gpu.download": _gpu_download,
    "update.check": _update_check,
    "update.install": _update_install,
    "advanced.open": _advanced_open,
    "advanced.seek": _advanced_seek,
    "advanced.capture": _advanced_capture,
    "advanced.segments": _advanced_segments,
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
