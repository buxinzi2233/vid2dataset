"""User preset persistence tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from vid2dataset.presets import list_preset_info, load_preset, save_preset


def test_save_and_load_user_preset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VID2DATASET_PRESET_DIR", str(tmp_path))

    name, path = save_preset(
        "My Sharp Preset",
        "Custom quality settings",
        {
            "resolution": 768,
            "blur_threshold": 120.0,
            "gpu_accel": True,
            "input": "/videos",
            "output": "/dataset",
            "segments": {"clip.mp4": [[1.0, 2.0]]},
        },
    )

    assert name == "my-sharp-preset"
    assert path == tmp_path / "my-sharp-preset.toml"
    text = path.read_text(encoding="utf-8")
    assert "input" not in text
    assert "output" not in text
    assert "segments" not in text
    assert load_preset(name) == {
        "resolution": 768,
        "blur_threshold": 120.0,
        "gpu_accel": True,
    }
    assert (name, "Custom quality settings", True) in list_preset_info()


def test_user_preset_cannot_overwrite_builtin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VID2DATASET_PRESET_DIR", str(tmp_path))

    with pytest.raises(ValueError, match="cannot be overwritten"):
        save_preset("anima-style", "", {"resolution": 768})
