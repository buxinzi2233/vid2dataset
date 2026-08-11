"""Smoke tests for the NDJSON sidecar (bridge/main.py).

Spawns the bridge subprocess and drives it via stdin/stdout to verify the
protocol framing, the real method registry, and the NotImplemented stub
behavior — all without touching the filesystem or launching long jobs.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Iterator
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
    resp = _exchange(proc, [{"id": 4, "method": "extract.run", "params": {}}])[0]
    assert resp["ok"] is False
    assert resp["error"]["code"] == "NotImplemented"


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
