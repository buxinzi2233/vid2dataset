"""Unit tests for FFmpeg binary and hardware-decoder selection."""

from __future__ import annotations

from pathlib import Path

from vid2dataset import keyframe_decoder as kd


def _path_matches(path: Path | str, expected: str) -> bool:
    """Compare paths in a Windows/POSIX-stable way for monkeypatched exists()."""
    return Path(path).as_posix() == Path(expected).as_posix()


def test_ffmpeg_candidates_keep_bundled_fallback_and_system(
    monkeypatch,
) -> None:
    bundled = "/opt/imageio/ffmpeg"

    class FakeImageioFFmpeg:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            return bundled

    monkeypatch.setitem(__import__("sys").modules, "imageio_ffmpeg", FakeImageioFFmpeg)
    # Path("/opt/...") stringifies with backslashes on Windows, so compare via as_posix().
    monkeypatch.setattr(Path, "exists", lambda self: _path_matches(self, bundled))
    monkeypatch.setattr(kd.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    assert kd._ffmpeg_candidates() == [bundled, "/usr/bin/ffmpeg"]


def test_ffmpeg_candidates_deduplicate_same_binary(monkeypatch) -> None:
    executable = "/usr/bin/ffmpeg"

    class FakeImageioFFmpeg:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            return executable

    monkeypatch.setitem(__import__("sys").modules, "imageio_ffmpeg", FakeImageioFFmpeg)
    monkeypatch.setattr(Path, "exists", lambda self: _path_matches(self, executable))
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


def test_cuda_keyframe_command_keeps_frames_on_device() -> None:
    cmd = kd._keyframe_decode_command(
        "/usr/bin/ffmpeg",
        Path("/tmp/sample.mp4"),
        "scale_cuda=768:432,hwdownload,format=nv12",
        "cuda",
        cuda_frames=True,
    )

    assert cmd[cmd.index("-hwaccel_output_format") + 1] == "cuda"
    assert cmd[cmd.index("-skip_frame") + 1] == "nokey"


def test_full_frame_command_does_not_skip_inter_frames() -> None:
    cmd = kd._frame_decode_command(
        "/usr/bin/ffmpeg",
        Path("/tmp/sample.mp4"),
        "scale=768:432,select='gte(t-prev_selected_t\\,0.25)'",
        "cuda",
        cuda_frames=True,
    )

    assert "-skip_frame" not in cmd
    assert cmd[cmd.index("-hwaccel_output_format") + 1] == "cuda"


def test_selected_frame_expression_collapses_consecutive_indexes() -> None:
    expression = kd._selected_frame_expression(list(range(120)))

    assert expression == r"between(n\,0\,119)"


def test_selected_frame_expression_balances_sparse_indexes() -> None:
    selected = list(range(0, 240, 2))
    expression = kd._selected_frame_expression(selected)

    assert expression.count("eq(n\\,") == 120
    assert expression.count("+") == 119
    # Seven balanced combination levels plus the eq(...) function call itself.
    assert _expression_depth(expression) <= 8


def test_selected_pts_expression_is_balanced() -> None:
    selected = list(range(0, 24000, 200))
    expression = kd._selected_pts_expression(selected)

    assert expression.count("eq(pts\\,") == 120
    assert _expression_depth(expression) <= 8


def _expression_depth(expression: str) -> int:
    depth = maximum = 0
    for char in expression:
        if char == "(":
            depth += 1
            maximum = max(maximum, depth)
        elif char == ")":
            depth -= 1
    return maximum
