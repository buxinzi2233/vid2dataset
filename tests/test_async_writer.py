"""Bounded asynchronous image writer tests."""

from __future__ import annotations

import threading
import time

import numpy as np

from vid2dataset import async_writer


def test_writer_applies_backpressure(monkeypatch, tmp_path) -> None:
    release = threading.Event()

    def slow_write(*_args, **_kwargs) -> None:
        release.wait(timeout=1)

    monkeypatch.setattr(async_writer, "_encode_and_write", slow_write)
    writer = async_writer.AsyncWriter(workers=1, max_pending=1)
    frame = np.zeros((8, 8, 3), dtype=np.uint8)
    writer.submit(frame, tmp_path / "a.png")

    finished = threading.Event()

    def submit_second() -> None:
        writer.submit(frame, tmp_path / "b.png")
        finished.set()

    thread = threading.Thread(target=submit_second)
    thread.start()
    time.sleep(0.05)
    assert not finished.is_set()
    release.set()
    thread.join(timeout=1)
    writer.close()
    assert finished.is_set()
