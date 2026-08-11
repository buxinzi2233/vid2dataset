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
import sys
import threading
from collections.abc import Callable

from vid2dataset.config import ExtractConfig
from vid2dataset.presets import list_presets


def _not_impl(name: str) -> None:
    raise NotImplementedError(name)


def _presets(_params: dict) -> list[dict]:
    return [{"name": n, "description": d} for n, d in list_presets()]


def _config_defaults(_params: dict) -> dict:
    return ExtractConfig.model_json_schema()["properties"]


METHODS: dict[str, Callable[[dict], object]] = {
    "config.defaults": _config_defaults,
    "config.validate": lambda p: _not_impl("config.validate"),
    "presets.list": _presets,
    "presets.load": lambda p: _not_impl("presets.load"),
    "source.discover": lambda p: _not_impl("source.discover"),
    "source.probe": lambda p: _not_impl("source.probe"),
    "extract.run": lambda p: _not_impl("extract.run"),
    "extract.cancel": lambda p: _not_impl("extract.cancel"),
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
