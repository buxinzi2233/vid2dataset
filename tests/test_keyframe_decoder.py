"""Unit tests for FFmpeg binary and hardware-decoder selection."""

from __future__ import annotations

from pathlib import Path

from vid2dataset import keyframe_decoder as kd


def test_ffmpeg_candidates_keep_bundled_fallback_and_system(
    monkeypatch,
) -> None:
    bundled = "/opt/imageio/ffmpeg"

    class FakeImageioFFmpeg:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            return bundled

    monkeypatch.setitem(__import__("sys").modules, "imageio_ffmpeg", FakeImageioFFmpeg)
    monkeypatch.setattr(Path, "exists", lambda self: str(self) == bundled)
    monkeypatch.setattr(kd.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    assert kd._ffmpeg_candidates() == [bundled, "/usr/bin/ffmpeg"]


def test_ffmpeg_candidates_deduplicate_same_binary(monkeypatch) -> None:
    executable = "/usr/bin/ffmpeg"

    class FakeImageioFFmpeg:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            return executable

    monkeypatch.setitem(__import__("sys").modules, "imageio_ffmpeg", FakeImageioFFmpeg)
    monkeypatch.setattr(Path, "exists", lambda self: str(self) == executable)
    monkeypatch.setattr(kd.shutil, "which", lambda name: executable)

    assert kd._ffmpeg_candidates() == [executable]


def test_hwaccel_selection_uses_capable_system_ffmpeg(monkeypatch) -> None:
    bundled = "/opt/imageio/ffmpeg"
    system = "/usr/bin/ffmpeg"
    monkeypatch.setattr(kd, "_ffmpeg_candidates", lambda: [bundled, system])
    monkeypatch.setattr(
        kd,
        "_list_hwaccels_for",
        lambda exe: ["vdpau"] if exe == bundled else ["cuda", "vaapi"],
    )

    assert kd._ffmpeg_exe() == bundled
    assert kd._ffmpeg_exe("cuda") == system
    assert kd._ffmpeg_exe("qsv") is None


def test_list_hwaccels_merges_all_binaries(monkeypatch) -> None:
    bundled = "/opt/imageio/ffmpeg"
    system = "/usr/bin/ffmpeg"
    monkeypatch.setattr(kd, "_ffmpeg_candidates", lambda: [bundled, system])
    monkeypatch.setattr(
        kd,
        "_list_hwaccels_for",
        lambda exe: ["vdpau"] if exe == bundled else ["cuda", "vdpau", "vaapi"],
    )

    assert kd.list_hwaccels() == ["vdpau", "cuda", "vaapi"]


def test_keyframe_command_uses_modern_fps_mode() -> None:
    cmd = kd._keyframe_decode_command(
        "/usr/bin/ffmpeg",
        Path("/tmp/sample.mp4"),
        "select='eq(pict_type,I)'",
        "cuda",
    )

    assert cmd[:6] == [
        "/usr/bin/ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-hwaccel",
        "cuda",
    ]
    assert cmd[cmd.index("-fps_mode") + 1] == "vfr"
    assert "-vsync" not in cmd
