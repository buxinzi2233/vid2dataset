"""Smoke tests for the NDJSON sidecar (bridge/main.py).

Spawns the bridge subprocess and drives it via stdin/stdout to verify the
protocol framing, the real method registry, and the NotImplemented stub
behavior — all without touching the filesystem or launching long jobs.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from subprocess import Popen

import pytest

BRIDGE = Path(__file__).resolve().parents[1] / "bridge" / "main.py"

# Prefer the repo venv so the sidecar can import vid2dataset; fall back to the
# interpreter running pytest (e.g. when tests run from a system python).
_venv = Path(__file__).resolve().parents[1] / "venv" / "bin" / "python"
PYTHON = str(_venv) if _venv.exists() else sys.executable


@pytest.fixture
def proc() -> Iterator[Popen[str]]:
    p = Popen(
        [PYTHON, "-u", str(BRIDGE)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    yield p
    p.kill()


def _exchange(proc: Popen[str], frames: list[dict]) -> list[dict]:
    """Write request frames, read back the same number of response frames."""
    assert proc.stdin is not None
    assert proc.stdout is not None
    for f in frames:
        proc.stdin.write(json.dumps(f) + "\n")
    proc.stdin.flush()
    out: list[dict] = []
    for _ in frames:
        line = proc.stdout.readline()
        assert line, "bridge closed stdout unexpectedly"
        out.append(json.loads(line))
    return out


def test_presets_list_returns_anima_style(proc) -> None:
    resp = _exchange(proc, [{"id": 1, "method": "presets.list", "params": {}}])[0]
    assert resp["id"] == 1
    assert resp["ok"] is True
    names = [r["name"] for r in resp["result"]]
    assert "anima-style" in names
    assert all("description" in r for r in resp["result"])


def test_preset_load_returns_overrides(proc) -> None:
    resp = _exchange(proc, [{"id": 6, "method": "presets.load",
                             "params": {"name": "anima-style"}}])[0]
    assert resp["ok"] is True
    result = resp["result"]
    # Known anima-style overrides, shaped as Partial<ExtractConfig>.
    assert result["sampling"] == "hybrid"
    assert result["resolution"] == 1024
    assert result["blur_threshold"] == 50.0
    assert "description" not in result  # description is metadata, stripped


def test_preset_load_unknown_errors(proc) -> None:
    resp = _exchange(proc, [{"id": 7, "method": "presets.load",
                             "params": {"name": "nope"}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] == "FileNotFoundError"


def test_config_defaults_has_resolution(proc) -> None:
    resp = _exchange(proc, [{"id": 2, "method": "config.defaults", "params": {}}])[0]
    assert resp["ok"] is True
    assert resp["result"]["resolution"]["type"] == "integer"
    assert resp["result"]["input"]["type"] == "string"


def test_unknown_method_rejected(proc) -> None:
    resp = _exchange(proc, [{"id": 3, "method": "nope.missing", "params": {}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] == "VALIDATION"


def test_stub_method_returns_not_implemented(proc) -> None:
    resp = _exchange(proc, [{"id": 4, "method": "tagger.run", "params": {}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] == "NotImplemented"


def test_extract_run_without_config_is_rejected(proc) -> None:
    resp = _exchange(proc, [{"id": 5, "method": "extract.run", "params": {}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] == "KeyError"


def test_bad_json_frame(proc) -> None:
    proc.stdin.write("not json\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    resp = json.loads(line)
    assert resp["ok"] is False
    assert resp["error"]["code"] == "VALIDATION"


def test_concurrent_requests_get_correct_ids(proc) -> None:
    frames = [{"id": i, "method": "presets.list", "params": {}} for i in range(10, 15)]
    out = _exchange(proc, frames)
    # Each request runs on its own thread; responses may arrive out of order,
    # but every id must be answered exactly once (id-correlation, not order).
    assert sorted(r["id"] for r in out) == [10, 11, 12, 13, 14]
    assert all(r["ok"] for r in out)


# ── extract.run integration ─────────────────────────────────────────────


def _write_video(path: Path, frames: int = 45, size: int = 320) -> None:
    import cv2
    import numpy as np

    w = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30, (size, size)
    )
    for i in range(frames):
        w.write(np.full((size, size, 3), i * 3 % 255, np.uint8))
    w.release()


def _read_frames_until(
    proc: Popen[str],
    predicate: Callable[[dict], bool],
    max_lines: int = 400,
) -> list[dict]:
    """Read stdout frames until ``predicate`` is satisfied; returns all frames."""
    assert proc.stdout is not None
    out: list[dict] = []
    for _ in range(max_lines):
        line = proc.stdout.readline()
        assert line, "bridge closed stdout before predicate matched"
        frame = json.loads(line)
        out.append(frame)
        if predicate(frame):
            return out
    raise AssertionError(f"predicate not satisfied after {max_lines} frames")


def _minimal_config(input_path: Path, output_path: Path) -> dict:
    return {
        "input": str(input_path),
        "output": str(output_path),
        "sampling": "interval",
        "interval_seconds": 0.1,
        "frames_per_scene": 1,
        "blur_threshold": 0.0,
        "min_brightness": 0.0,
        "max_brightness": 255.0,
        "min_contrast": 0.0,
        "detect_letterbox": False,
        "resolution": 256,
        "min_bucket": 256,
        "max_bucket": 512,
        "bucket_step": 64,
        "min_pixels": 0,
        "resize_mode": "cover",
        "dedup": False,
        "ssim_filter": False,
        "color_diversity": False,
        "auto_quality": False,
        "decode_mode": "accurate",
        "contact_sheet": False,
        "html_gallery": False,
        "skip_existing": False,
    }


def test_extract_run_streams_events_and_done(proc, tmp_path) -> None:
    video = tmp_path / "clip.mp4"
    _write_video(video)
    cfg = _minimal_config(video, tmp_path / "out")

    proc.stdin.write(json.dumps({"id": 50, "method": "extract.run", "params": {"config": cfg}}) + "\n")
    proc.stdin.flush()

    frames = _read_frames_until(proc, lambda f: f.get("event") == "extract.done")
    started = frames[0]
    assert started["id"] == 50 and started["ok"] is True
    assert started["result"] == {"started": True}

    progress = [f for f in frames if f.get("event") == "extract.progress"]
    assert progress, "expected extract.progress events"
    assert all("stage" in f["data"] for f in progress)

    done = frames[-1]
    assert done["event"] == "extract.done"
    assert done["data"]["total_written"] >= 1
    assert (tmp_path / "out").exists()


def test_extract_cancel_sets_event(proc, tmp_path) -> None:
    video = tmp_path / "long.mp4"
    _write_video(video, frames=120)
    cfg = _minimal_config(video, tmp_path / "out")

    proc.stdin.write(json.dumps({"id": 60, "method": "extract.run", "params": {"config": cfg}}) + "\n")
    proc.stdin.flush()
    # Consume the fast started-response.
    resp = json.loads(proc.stdout.readline())
    assert resp["ok"] is True

    proc.stdin.write(json.dumps({"id": 61, "method": "extract.cancel", "params": {}}) + "\n")
    proc.stdin.flush()
    cancel_resp = json.loads(proc.stdout.readline())
    assert cancel_resp["id"] == 61 and cancel_resp["ok"] is True
    assert cancel_resp["result"]["cancelled"] is True

    # The run eventually emits extract.done (possibly with partial output).
    _read_frames_until(proc, lambda f: f.get("event") == "extract.done", max_lines=600)


# ── source.discover / source.probe ──────────────────────────────────────


def test_source_discover_lists_directory_videos(proc, tmp_path) -> None:
    _write_video(tmp_path / "a.mp4", frames=10)
    _write_video(tmp_path / "b.mkv", frames=10)
    (tmp_path / "note.txt").write_text("x")

    resp = _exchange(proc, [{"id": 70, "method": "source.discover",
                             "params": {"path": str(tmp_path)}}])[0]
    assert resp["ok"] is True
    names = sorted(Path(p).name for p in resp["result"])
    assert names == ["a.mp4", "b.mkv"]


def test_source_discover_single_file(proc, tmp_path) -> None:
    video = tmp_path / "clip.mp4"
    _write_video(video, frames=10)

    resp = _exchange(proc, [{"id": 71, "method": "source.discover",
                             "params": {"path": str(video)}}])[0]
    assert resp["ok"] is True
    assert resp["result"] == [str(video)]


def test_source_probe_returns_metadata(proc, tmp_path) -> None:
    video = tmp_path / "clip.mp4"
    _write_video(video, frames=45)

    resp = _exchange(proc, [{"id": 72, "method": "source.probe",
                             "params": {"path": str(video)}}])[0]
    assert resp["ok"] is True
    meta = resp["result"]
    assert meta["path"] == str(video)
    assert meta["width"] > 0 and meta["height"] > 0
    assert meta["frame_count"] >= 45
    assert meta["fps"] > 0
    assert meta["duration_s"] > 0


def test_source_probe_missing_file_errors(proc, tmp_path) -> None:
    resp = _exchange(proc, [{"id": 73, "method": "source.probe",
                             "params": {"path": str(tmp_path / "nope.mp4")}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] != "NotImplemented"


# ── tagger.status / tagger.download ─────────────────────────────────────


def test_tagger_status_returns_model_info(proc) -> None:
    resp = _exchange(proc, [{"id": 80, "method": "tagger.status",
                             "params": {"model": "wd-eva02-large-tagger-v3"}}])[0]
    assert resp["ok"] is True
    result = resp["result"]
    assert isinstance(result["available"], bool)
    assert result["size_mb"] > 0


def test_tagger_download_rejects_unknown_model(proc) -> None:
    resp = _exchange(proc, [{"id": 81, "method": "tagger.download",
                             "params": {"model": "does-not-exist"}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] == "ValueError"


def test_tagger_download_starts_immediately(proc) -> None:
    """tagger.download answers fast with `started` and streams download events.

    We deliberately do NOT wait for `download.done` here: with a valid model the
    worker downloads a multi-hundred-MB model over the network, which must not
    run in CI. The async event protocol is already covered by the extract.run
    integration tests; this test only pins the fast-start contract.
    """
    resp = _exchange(proc, [{"id": 82, "method": "tagger.download",
                             "params": {"model": "wd-swinv2-tagger-v3"}}])[0]
    assert resp["ok"] is True
    assert resp["result"] == {"started": True}


# ── gpu.detect / gpu.status ─────────────────────────────────────────────


def test_gpu_detect_returns_profile(proc) -> None:
    resp = _exchange(proc, [{"id": 90, "method": "gpu.detect", "params": {}}])[0]
    assert resp["ok"] is True
    result = resp["result"]
    assert result["vendor"] in ("NVIDIA", "AMD", "Intel", "Apple", "Unknown")
    assert isinstance(result["gpu_name"], str)
    assert isinstance(result["compute_cap"], float)
    assert result["os_name"] in ("windows", "linux", "macos")
    assert result["os_arch"] in ("x86_64", "arm64")


def test_gpu_status_returns_runtime_state(proc) -> None:
    resp = _exchange(proc, [{"id": 91, "method": "gpu.status", "params": {}}])[0]
    assert resp["ok"] is True
    result = resp["result"]
    assert isinstance(result["available"], bool)
    assert isinstance(result["cached"], bool)
    assert isinstance(result["cache_dir"], str)
    assert isinstance(result["size_mb"], float)

