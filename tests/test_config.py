"""Smoke test for the config module."""

from __future__ import annotations

from pathlib import Path

import pytest

from vid2dataset.config import ExtractConfig


def test_defaults_match_anima(tmp_path: Path) -> None:
    """Anima official defaults: resolution 1024, min_pixels 500_000, step 64."""
    cfg = ExtractConfig(input=tmp_path)
    assert cfg.resolution == 1024
    assert cfg.min_pixels == 500_000
    assert cfg.bucket_step == 64
    assert cfg.min_bucket == 512
    assert cfg.max_bucket == 2048
    assert cfg.output_mode == "bucket"
    assert cfg.dedup_mode == "standard"


def test_native_strong_config(tmp_path: Path) -> None:
    cfg = ExtractConfig(
        input=tmp_path,
        output_mode="native",
        output_format="png",
        png_compression=1,
        dedup_mode="strong",
        dedup_scope="global",
        dedup_keep="sharpest",
    )
    assert cfg.output_mode == "native"
    assert cfg.png_compression == 1
    assert cfg.dedup_feature_threshold == 0.985
    assert cfg.dedup_content_threshold == 0.0
    assert cfg.native_scan_interval_seconds == 0.25
    assert cfg.native_scene_threshold == 0.08
    assert cfg.dedup_min_seconds == 0.0
    assert cfg.dedup_temporal_feature_threshold == 1.0
    assert cfg.auto_quality_window_seconds == 0.0


def test_temporal_dedup_spacing_is_bounded(tmp_path: Path) -> None:
    cfg = ExtractConfig(input=tmp_path, dedup_min_seconds=2.0)
    assert cfg.dedup_min_seconds == 2.0

    with pytest.raises(ValueError):
        ExtractConfig(input=tmp_path, dedup_min_seconds=-0.1)


def test_coverage_quality_windows_are_bounded(tmp_path: Path) -> None:
    cfg = ExtractConfig(
        input=tmp_path,
        auto_quality_window_seconds=20.0,
    )
    assert cfg.auto_quality_window_seconds == 20.0

    with pytest.raises(ValueError):
        ExtractConfig(input=tmp_path, dedup_temporal_feature_threshold=1.1)


def test_native_full_frame_scan_controls_are_bounded(tmp_path: Path) -> None:
    cfg = ExtractConfig(
        input=tmp_path,
        native_scan_interval_seconds=0.1,
        native_scene_threshold=0.04,
    )
    assert cfg.native_scan_interval_seconds == 0.1
    assert cfg.native_scene_threshold == 0.04

    with pytest.raises(ValueError):
        ExtractConfig(input=tmp_path, native_scan_interval_seconds=0.0)
    with pytest.raises(ValueError):
        ExtractConfig(input=tmp_path, native_scene_threshold=1.1)
    with pytest.raises(ValueError):
        ExtractConfig(input=tmp_path, dedup_content_threshold=1.1)


def test_native_mode_rejects_lossy_output(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="requires lossless PNG"):
        ExtractConfig(input=tmp_path, output_mode="native", output_format="jpg")


def test_strong_dedup_requires_native_mode(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="requires native"):
        ExtractConfig(input=tmp_path, dedup_mode="strong")


def test_resolution_must_be_aligned(tmp_path: Path) -> None:
    # The config validator enforces multiple-of-8; the full multiple-of-step
    # check happens in resize.generate_buckets.
    with pytest.raises(ValueError):
        ExtractConfig(input=tmp_path, resolution=1023)


def test_to_toml_dict_strips_none_and_paths(tmp_path: Path) -> None:
    cfg = ExtractConfig(input=tmp_path, output=tmp_path / "out")
    d = cfg.to_toml_dict()
    assert isinstance(d["input"], str)
    assert isinstance(d["output"], str)
    # dedup_index is None → should be dropped
    assert "dedup_index" not in d


def test_load_preset_overrides_via_toml(tmp_path: Path) -> None:
    f = tmp_path / "p.toml"
    f.write_text(
        'resolution = 768\nblur_threshold = 50\n', encoding="utf-8"
    )
    cfg = ExtractConfig.from_toml(f, overrides={"input": tmp_path})
    assert cfg.resolution == 768
    assert cfg.blur_threshold == 50
    # Untouched fields keep defaults
    assert cfg.min_pixels == 500_000
