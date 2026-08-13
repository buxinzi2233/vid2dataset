"""Fast keyframe extraction via ffmpeg.

Uses FFmpeg to decode only I-frames (keyframes) from a video. The bundled
imageio-ffmpeg binary is the portable CPU fallback; when hardware decoding is
requested, a system FFmpeg with the matching hwaccel is preferred.
"""

from __future__ import annotations

import contextlib
import logging
import queue
import re
import shutil
import subprocess
import sys as _sys
import threading
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
    *,
    cuda_frames: bool = False,
    loglevel: str = "error",
) -> list[str]:
    """Build the streaming keyframe command for modern and bundled FFmpeg."""
    return _frame_decode_command(
        exe,
        video_path,
        vf,
        hwaccel,
        cuda_frames=cuda_frames,
        keyframes_only=True,
        loglevel=loglevel,
    )


def _frame_decode_command(
    exe: str,
    video_path: Path,
    vf: str,
    hwaccel: str | None,
    *,
    cuda_frames: bool = False,
    keyframes_only: bool = False,
    loglevel: str = "error",
) -> list[str]:
    """Build a streaming FFmpeg command for keyframes or the full timeline."""
    cmd = [exe, "-hide_banner", "-loglevel", loglevel]
    if hwaccel:
        cmd.extend(["-hwaccel", hwaccel])
    if cuda_frames:
        cmd.extend(["-hwaccel_output_format", "cuda"])
    if keyframes_only:
        cmd.extend(["-skip_frame", "nokey"])
    cmd.extend([
        "-i", str(video_path),
        "-vf", vf, "-fps_mode", "vfr", "-an",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ])
    return cmd


def _ffprobe_exe() -> str | None:
    return shutil.which("ffprobe")


def probe_keyframe_timestamps(video_path: Path) -> list[float]:
    """Return exact keyframe timestamps in decode order when ffprobe exists."""
    exe = _ffprobe_exe()
    if not exe:
        return []
    try:
        result = subprocess.run(
            [
                exe,
                "-v", "error",
                "-select_streams", "v:0",
                "-skip_frame", "nokey",
                "-show_entries", "frame=best_effort_timestamp_time",
                "-of", "csv=p=0",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            errors="ignore",
            creationflags=_NO_WINDOW,
        )
    except Exception as e:
        log.debug("ffprobe keyframe timestamps failed for %s: %s", video_path, e)
        return []
    timestamps: list[float] = []
    for line in result.stdout.splitlines():
        raw = line.strip().split(",", 1)[0]
        try:
            timestamps.append(float(raw))
        except ValueError:
            continue
    return timestamps


def _scaled_keyframe_filter(
    width: int,
    height: int,
    out_w: int,
    out_h: int,
    *,
    cuda_frames: bool,
) -> str:
    if cuda_frames:
        if (out_w, out_h) != (width, height):
            return (
                f"scale_cuda={out_w}:{out_h}:interp_algo=lanczos,"
                "hwdownload,format=nv12"
            )
        return "hwdownload,format=nv12"
    if (out_w, out_h) != (width, height):
        return f"scale={out_w}:{out_h}:flags=lanczos"
    return "null"


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
    exact_timestamps: bool = False,
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

    cuda_frames = hwaccel == "cuda" and (out_w, out_h) != (width, height)
    vf = _scaled_keyframe_filter(
        width,
        height,
        out_w,
        out_h,
        cuda_frames=cuda_frames,
    )
    if exact_timestamps:
        vf = f"{vf},showinfo"

    cmd = _keyframe_decode_command(
        exe,
        video_path,
        vf,
        hwaccel,
        cuda_frames=cuda_frames,
        loglevel="info" if exact_timestamps else "error",
    )
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        bufsize=10**8, creationflags=_NO_WINDOW,
    )

    frame_size = out_w * out_h * 3
    yielded = 0
    timestamp_queue: queue.Queue[float] = queue.Queue()
    stderr_tail: list[bytes] = []

    def _read_stderr() -> None:
        if proc.stderr is None:
            return
        for line in iter(proc.stderr.readline, b""):
            stderr_tail.append(line)
            if len(stderr_tail) > 40:
                del stderr_tail[0]
            if exact_timestamps:
                match = re.search(rb"pts_time:([-+0-9.eE]+)", line)
                if match:
                    with contextlib.suppress(ValueError):
                        timestamp_queue.put(float(match.group(1)))

    stderr_thread = threading.Thread(target=_read_stderr, daemon=True)
    stderr_thread.start()
    try:
        while True:
            if max_count is not None and yielded >= max_count:
                break
            buf = proc.stdout.read(frame_size)
            if len(buf) < frame_size:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape((out_h, out_w, 3))
            if exact_timestamps:
                try:
                    timestamp = timestamp_queue.get(timeout=5)
                except queue.Empty:
                    timestamp = yielded * 2.0
            else:
                timestamp = yielded * 2.0
            yield timestamp, frame
            yielded += 1
    finally:
        with contextlib.suppress(Exception):
            proc.stdout.close()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        stderr_thread.join(timeout=1)
        if proc.returncode not in (0, None) and yielded == 0:
            err = b"".join(stderr_tail)
            raise OSError(
                f"ffmpeg exited {proc.returncode}: "
                f"{err.decode('utf-8', errors='ignore')[:500]}"
            )


def extract_selected_keyframes(
    video_path: Path,
    keyframe_indices: list[int],
    *,
    hwaccel: str | None = None,
    timestamps: list[float] | None = None,
) -> Iterator[tuple[int, float, np.ndarray]]:
    """Decode only selected I-frames at the source video's native resolution.

    A single FFmpeg process scans the video. With CUDA, selection happens on
    hardware frames and only winners cross the PCIe boundary.
    """
    selected = sorted({int(i) for i in keyframe_indices if i >= 0})
    if not selected:
        return
    exe = _ffmpeg_exe(hwaccel)
    if not exe:
        raise OSError("No compatible FFmpeg binary is available")
    width, height = probe_resolution(video_path)
    if width <= 0 or height <= 0:
        raise OSError(f"Could not probe resolution of {video_path}")

    expression = _selected_frame_expression(selected)
    cuda_frames = hwaccel == "cuda"
    if cuda_frames:
        vf = f"select='{expression}',hwdownload,format=nv12"
    else:
        vf = f"select='{expression}'"
    cmd = _keyframe_decode_command(
        exe,
        video_path,
        vf,
        hwaccel,
        cuda_frames=cuda_frames,
    )
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=10**8,
        creationflags=_NO_WINDOW,
    )
    exact_timestamps = timestamps or []
    frame_size = width * height * 3
    yielded = 0
    try:
        for keyframe_index in selected:
            buf = proc.stdout.read(frame_size)
            if len(buf) < frame_size:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape((height, width, 3))
            timestamp = (
                exact_timestamps[keyframe_index]
                if keyframe_index < len(exact_timestamps)
                else float(keyframe_index)
            )
            yield keyframe_index, timestamp, frame
            yielded += 1
    finally:
        with contextlib.suppress(Exception):
            proc.stdout.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if yielded != len(selected):
            err = b""
            with contextlib.suppress(Exception):
                err = proc.stderr.read() or b""
            raise OSError(
                f"FFmpeg returned {yielded}/{len(selected)} selected keyframes: "
                f"{err.decode('utf-8', errors='ignore')[:500]}"
            )


def extract_content_frames(
    video_path: Path,
    *,
    interval_seconds: float,
    scene_threshold: float,
    downscale_long_edge: int,
    hwaccel: str | None = None,
) -> Iterator[tuple[int, float, np.ndarray]]:
    """Scan every decoded frame and yield content-change/interval candidates.

    FFmpeg evaluates the scene-change expression over the complete timeline.
    CUDA decoding and scaling stay on the GPU when available; downscaled
    proxies cross the device boundary for scene analysis. Integer PTS values
    identify the exact source frames for the native-resolution write stage.
    """
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be positive")
    if not 0.0 <= scene_threshold <= 1.0:
        raise ValueError("scene_threshold must be between 0 and 1")

    exe = _ffmpeg_exe(hwaccel)
    if not exe:
        if hwaccel:
            raise OSError(f"No FFmpeg binary supports hwaccel '{hwaccel}'")
        raise ImportError("ffmpeg not available. Install imageio-ffmpeg.")
    width, height = probe_resolution(video_path)
    if width <= 0 or height <= 0:
        raise OSError(f"Could not probe resolution of {video_path}")

    scale = min(1.0, downscale_long_edge / max(width, height))
    out_w = max(2, int(round(width * scale)) // 2 * 2)
    out_h = max(2, int(round(height * scale)) // 2 * 2)
    cuda_frames = hwaccel == "cuda" and (out_w, out_h) != (width, height)
    base_filter = _scaled_keyframe_filter(
        width,
        height,
        out_w,
        out_h,
        cuda_frames=cuda_frames,
    )
    expression = (
        "isnan(prev_selected_t)"
        f"+gte(t-prev_selected_t\\,{interval_seconds:.6f})"
        f"+gt(scene\\,{scene_threshold:.6f})"
    )
    vf = f"{base_filter},select='{expression}',showinfo"
    cmd = _frame_decode_command(
        exe,
        video_path,
        vf,
        hwaccel,
        cuda_frames=cuda_frames,
        loglevel="info",
    )
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=10**8,
        creationflags=_NO_WINDOW,
    )
    frame_size = out_w * out_h * 3
    metadata_queue: queue.Queue[tuple[int, float]] = queue.Queue()
    stderr_tail: list[bytes] = []

    def _read_stderr() -> None:
        if proc.stderr is None:
            return
        for line in iter(proc.stderr.readline, b""):
            stderr_tail.append(line)
            if len(stderr_tail) > 40:
                del stderr_tail[0]
            pts_match = re.search(rb"\bpts:\s*(-?\d+)", line)
            time_match = re.search(rb"pts_time:([-+0-9.eE]+)", line)
            if pts_match and time_match:
                with contextlib.suppress(ValueError):
                    metadata_queue.put(
                        (int(pts_match.group(1)), float(time_match.group(1)))
                    )

    stderr_thread = threading.Thread(target=_read_stderr, daemon=True)
    stderr_thread.start()
    yielded = 0
    reached_eof = False
    try:
        while True:
            buf = proc.stdout.read(frame_size)
            if len(buf) < frame_size:
                reached_eof = True
                break
            try:
                pts, timestamp = metadata_queue.get(timeout=5)
            except queue.Empty as exc:
                raise OSError("FFmpeg did not report candidate frame timestamps") from exc
            frame = np.frombuffer(buf, dtype=np.uint8).reshape((out_h, out_w, 3))
            yield pts, timestamp, frame
            yielded += 1
    finally:
        with contextlib.suppress(Exception):
            proc.stdout.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        stderr_thread.join(timeout=1)
        if reached_eof and proc.returncode not in (0, None):
            err = b"".join(stderr_tail)
            raise OSError(
                f"ffmpeg exited {proc.returncode}: "
                f"{err.decode('utf-8', errors='ignore')[:500]}"
            )


def extract_selected_frames(
    video_path: Path,
    frame_pts: list[int],
    *,
    hwaccel: str | None = None,
) -> Iterator[tuple[int, np.ndarray]]:
    """Decode exact full-timeline frames selected by their source PTS."""
    selected = sorted({int(value) for value in frame_pts})
    if not selected:
        return
    exe = _ffmpeg_exe(hwaccel)
    if not exe:
        raise OSError("No compatible FFmpeg binary is available")
    width, height = probe_resolution(video_path)
    if width <= 0 or height <= 0:
        raise OSError(f"Could not probe resolution of {video_path}")

    expression = _selected_pts_expression(selected)
    cuda_frames = hwaccel == "cuda"
    vf = f"select='{expression}'"
    if cuda_frames:
        vf += ",hwdownload,format=nv12"
    cmd = _frame_decode_command(
        exe,
        video_path,
        vf,
        hwaccel,
        cuda_frames=cuda_frames,
    )
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=10**8,
        creationflags=_NO_WINDOW,
    )
    frame_size = width * height * 3
    yielded = 0
    try:
        for pts in selected:
            buf = proc.stdout.read(frame_size)
            if len(buf) < frame_size:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape((height, width, 3))
            yield pts, frame
            yielded += 1
    finally:
        with contextlib.suppress(Exception):
            proc.stdout.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if yielded != len(selected):
            err = b""
            with contextlib.suppress(Exception):
                err = proc.stderr.read() or b""
            raise OSError(
                f"FFmpeg returned {yielded}/{len(selected)} selected frames: "
                f"{err.decode('utf-8', errors='ignore')[:500]}"
            )


def _selected_frame_expression(selected: list[int]) -> str:
    """Build a shallow FFmpeg select expression for sorted frame indexes.

    FFmpeg's expression parser exhausts its stack around 120 terms when they
    are joined as a linear ``eq(n,0)+eq(n,1)+...`` chain. Collapse consecutive
    indexes into ranges, then combine the remaining terms as a balanced tree so
    parser depth grows logarithmically for sparse selections too.
    """
    if not selected:
        raise ValueError("selected frame indexes must not be empty")

    terms: list[str] = []
    start = previous = selected[0]
    for index in selected[1:]:
        if index == previous + 1:
            previous = index
            continue
        terms.append(_selected_frame_term(start, previous))
        start = previous = index
    terms.append(_selected_frame_term(start, previous))

    while len(terms) > 1:
        terms = [
            f"({terms[index]}+{terms[index + 1]})"
            if index + 1 < len(terms)
            else terms[index]
            for index in range(0, len(terms), 2)
        ]
    return terms[0]


def _selected_frame_term(start: int, end: int) -> str:
    if start == end:
        return f"eq(n\\,{start})"
    return f"between(n\\,{start}\\,{end})"


def _selected_pts_expression(selected: list[int]) -> str:
    """Build a balanced FFmpeg select expression for exact integer PTS values."""
    if not selected:
        raise ValueError("selected PTS values must not be empty")
    terms = [f"eq(pts\\,{value})" for value in selected]
    while len(terms) > 1:
        terms = [
            f"({terms[index]}+{terms[index + 1]})"
            if index + 1 < len(terms)
            else terms[index]
            for index in range(0, len(terms), 2)
        ]
    return terms[0]


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
