"""Fast keyframe extraction via ffmpeg.

Uses FFmpeg to decode only I-frames (keyframes) from a video. The bundled
imageio-ffmpeg binary is the portable CPU fallback; when hardware decoding is
requested, a system FFmpeg with the matching hwaccel is preferred.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys as _sys
from collections.abc import Iterator
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

# Hide ffmpeg console windows on Windows. Without this every subprocess
# call pops up a console window briefly, which steals keyboard focus.
_NO_WINDOW = 0x08000000 if _sys.platform == 'win32' else 0


def _ffmpeg_candidates() -> list[str]:
    """Return usable FFmpeg binaries in portable-fallback order."""
    candidates: list[str] = []
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).exists():
            candidates.append(exe)
    except Exception:
        pass
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg and sys_ffmpeg not in candidates:
        candidates.append(sys_ffmpeg)
    return candidates


def _list_hwaccels_for(exe: str) -> list[str]:
    """Return hardware acceleration methods compiled into one FFmpeg."""
    try:
        result = subprocess.run(
            [exe, "-hide_banner", "-hwaccels"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=_NO_WINDOW,
        )
        return [
            line.strip()
            for line in result.stdout.splitlines()
            if line.strip() and ":" not in line
        ]
    except Exception as e:
        log.debug("Failed to list hwaccels for %s: %s", exe, e)
        return []


def _ffmpeg_exe(hwaccel: str | None = None) -> str | None:
    """Return an FFmpeg binary, optionally requiring a specific hwaccel."""
    candidates = _ffmpeg_candidates()
    if hwaccel is None:
        return candidates[0] if candidates else None
    for exe in candidates:
        if hwaccel in _list_hwaccels_for(exe):
            return exe
    return None


def has_ffmpeg() -> bool:
    return _ffmpeg_exe() is not None


def _keyframe_decode_command(
    exe: str,
    video_path: Path,
    vf: str,
    hwaccel: str | None,
) -> list[str]:
    """Build the streaming keyframe command for modern and bundled FFmpeg."""
    cmd = [exe, "-hide_banner", "-loglevel", "error"]
    if hwaccel:
        cmd.extend(["-hwaccel", hwaccel])
    cmd.extend([
        "-i", str(video_path),
        "-vf", vf, "-fps_mode", "vfr", "-an",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ])
    return cmd


def probe_resolution(video_path: Path) -> tuple[int, int]:
    """Return (width, height) of the first video stream. (0,0) on failure."""
    exe = _ffmpeg_exe()
    if not exe:
        return (0, 0)
    try:
        result = subprocess.run(
            [exe, "-i", str(video_path), "-hide_banner"],
            capture_output=True, text=True, timeout=10, errors="ignore",
            creationflags=_NO_WINDOW,
        )
        for line in result.stderr.splitlines():
            if "Video:" in line:
                m = re.search(r"(\d{2,5})x(\d{2,5})", line)
                if m:
                    return (int(m.group(1)), int(m.group(2)))
    except Exception as e:
        log.debug("ffprobe failed for %s: %s", video_path, e)
    return (0, 0)


def extract_keyframes(
    video_path: Path,
    *,
    max_count: int | None = None,
    downscale_long_edge: int | None = None,
    timeout: float = 600.0,
    hwaccel: str | None = None,
) -> Iterator[tuple[float, np.ndarray]]:
    """Yield (timestamp_seconds, frame_bgr) for I-frames via ffmpeg pipe."""
    exe = _ffmpeg_exe(hwaccel)
    if not exe:
        if hwaccel:
            raise OSError(f"No FFmpeg binary supports hwaccel '{hwaccel}'")
        raise ImportError("ffmpeg not available. Install imageio-ffmpeg.")

    width, height = probe_resolution(video_path)
    if width <= 0:
        raise OSError(f"Could not probe resolution of {video_path}")

    out_w, out_h = width, height
    if downscale_long_edge and max(width, height) > downscale_long_edge:
        scale = downscale_long_edge / max(width, height)
        out_w = max(2, int(round(width * scale)) // 2 * 2)
        out_h = max(2, int(round(height * scale)) // 2 * 2)

    vf_parts = ["select='eq(pict_type,I)'"]
    if (out_w, out_h) != (width, height):
        vf_parts.append(f"scale={out_w}:{out_h}")
    vf = ",".join(vf_parts)

    cmd = _keyframe_decode_command(exe, video_path, vf, hwaccel)
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        bufsize=10**8, creationflags=_NO_WINDOW,
    )

    frame_size = out_w * out_h * 3
    yielded = 0
    approx_interval = 2.0
    import contextlib
    try:
        while True:
            if max_count is not None and yielded >= max_count:
                break
            buf = proc.stdout.read(frame_size)
            if len(buf) < frame_size:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape((out_h, out_w, 3))
            yield yielded * approx_interval, frame
            yielded += 1
    finally:
        with contextlib.suppress(Exception):
            proc.stdout.close()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        if proc.returncode not in (0, None) and yielded == 0:
            err = b""
            with contextlib.suppress(Exception):
                err = proc.stderr.read() or b''
            raise OSError(
                f"ffmpeg exited {proc.returncode}: "
                f"{err.decode('utf-8', errors='ignore')[:500]}"
            )


def extract_at_timestamps(
    video_path: Path,
    timestamps: list[float],
    *,
    downscale_long_edge: int | None = None,
) -> Iterator[tuple[float, np.ndarray]]:
    """Yield (timestamp, frame_bgr) by ffmpeg -ss seek per timestamp."""
    exe = _ffmpeg_exe()
    if not exe:
        raise ImportError("ffmpeg not available")

    width, height = probe_resolution(video_path)
    if width <= 0:
        raise OSError(f"Could not probe {video_path}")

    out_w, out_h = width, height
    if downscale_long_edge and max(width, height) > downscale_long_edge:
        scale = downscale_long_edge / max(width, height)
        out_w = max(2, int(round(width * scale)) // 2 * 2)
        out_h = max(2, int(round(height * scale)) // 2 * 2)

    for ts in timestamps:
        cmd = [
            exe, "-hide_banner", "-loglevel", "error",
            "-ss", f"{ts:.3f}", "-i", str(video_path),
            "-frames:v", "1", "-an",
        ]
        if (out_w, out_h) != (width, height):
            cmd.extend(["-vf", f"scale={out_w}:{out_h}"])
        cmd.extend(["-f", "rawvideo", "-pix_fmt", "bgr24", "-"])
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=30, creationflags=_NO_WINDOW)
            need = out_w * out_h * 3
            if len(result.stdout) >= need:
                frame = np.frombuffer(result.stdout[:need], dtype=np.uint8).reshape((out_h, out_w, 3))
                yield ts, frame
        except subprocess.TimeoutExpired:
            log.warning("ffmpeg timeout at ts=%.2f for %s", ts, video_path)

# ── GPU acceleration probe ─────────────────────────────────────────────


def list_hwaccels() -> list[str]:
    """Return the union of hwaccels available across all FFmpeg binaries."""
    methods: list[str] = []
    for exe in _ffmpeg_candidates():
        for method in _list_hwaccels_for(exe):
            if method not in methods:
                methods.append(method)
    return methods


def validate_hwaccel(video_path: Path, hwaccel: str, *, timeout: float = 10.0) -> bool:
    """Return True if decoding `video_path` with `hwaccel` produces sane output.

    Strategy: extract ONE keyframe with hwaccel, ONE without. Compare by computing
    a coarse downsampled mean-square diff. If the diff is tiny the hwaccel path
    is producing the same frames as CPU \u2014 safe to use. If the diff is large or
    hwaccel errors out, return False.
    """
    exe = _ffmpeg_exe(hwaccel)
    if not exe:
        log.warning("No FFmpeg binary supports hwaccel '%s'", hwaccel)
        return False

    width, height = probe_resolution(video_path)
    if width <= 0:
        return False

    # Decode one keyframe with hwaccel
    cmd_gpu = [
        exe, "-hide_banner", "-loglevel", "error",
        "-hwaccel", hwaccel,
        "-i", str(video_path),
        "-vf", "select='eq(pict_type,I)',scale=128:128",
        "-vframes", "1",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    cmd_cpu = [
        exe, "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-vf", "select='eq(pict_type,I)',scale=128:128",
        "-vframes", "1",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    need = 128 * 128 * 3
    try:
        gpu_buf = subprocess.run(
            cmd_gpu, capture_output=True, timeout=timeout, creationflags=_NO_WINDOW,
        ).stdout
        cpu_buf = subprocess.run(
            cmd_cpu, capture_output=True, timeout=timeout, creationflags=_NO_WINDOW,
        ).stdout
    except subprocess.TimeoutExpired:
        log.warning("hwaccel '%s' timed out during validation", hwaccel)
        return False
    except Exception as e:
        log.warning("hwaccel '%s' validation failed: %s", hwaccel, e)
        return False

    if len(gpu_buf) < need or len(cpu_buf) < need:
        log.warning("hwaccel '%s' produced no frame", hwaccel)
        return False

    gpu_arr = np.frombuffer(gpu_buf[:need], dtype=np.uint8).astype(np.int32)
    cpu_arr = np.frombuffer(cpu_buf[:need], dtype=np.uint8).astype(np.int32)
    mse = float(((gpu_arr - cpu_arr) ** 2).mean())
    # MSE > 200 means significantly different (uint8 channel range 0-255)
    if mse > 200:
        log.warning("hwaccel '%s' output diverges from CPU (MSE=%.1f) \u2014 disabled", hwaccel, mse)
        return False
    log.info("hwaccel '%s' validated (MSE=%.2f vs CPU)", hwaccel, mse)
    return True


def auto_select_hwaccel(sample_video: Path) -> str | None:
    """Pick the best hwaccel that passes validation, or None.

    Tried in order: cuda, qsv, d3d11va, dxva2, vaapi. Returns the first one
    whose decoded output matches CPU within tolerance.
    """
    available = list_hwaccels()
    preferred = ["cuda", "qsv", "d3d11va", "dxva2", "vaapi"]
    for method in preferred:
        if method not in available:
            continue
        if validate_hwaccel(sample_video, method):
            return method
    return None
