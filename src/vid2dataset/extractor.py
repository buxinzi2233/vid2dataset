"""Pipeline orchestrator.

Wires all modules together:

    discover videos
        (optional) auto-quality calibration per video
        for each video:
            scene detection
                for each scene:
                    sample N candidate frame indices
                    decode (accurate or keyframe-snap)
                    letterbox-crop
                    quality gate (blur + luma)
                    completeness filter (optional)
                    bucket-resize
                    SSIM diversity check
                    color diversity check
                    pHash global dedup
                    write image
            per-video stats.json
        contact sheet + HTML gallery
"""

from __future__ import annotations

import heapq
import json
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np

from vid2dataset.async_writer import AsyncWriter
from vid2dataset.auto_quality import auto_detect_blur_threshold
from vid2dataset.color_diversity import ColorDiversityFilter
from vid2dataset.completeness import is_subject_complete, is_subject_large_enough
from vid2dataset.config import ExtractConfig
from vid2dataset.crop import detect_letterbox
from vid2dataset.dedup import DedupIndex, hash_image
from vid2dataset.diversity import DiversityFilter
from vid2dataset.gallery import generate_contact_sheet, generate_html_gallery
from vid2dataset.gpu_filters import BatchSSIMFilter, is_gpu_pipeline_available
from vid2dataset.hardware import auto_detect_workers
from vid2dataset.io_utils import (
    VideoMeta,
    discover_videos,
    probe_video,
    read_frames_at,
    sanitize_stem,
)
from vid2dataset.keyframe_decoder import (
    auto_select_hwaccel,
    extract_content_frames,
    extract_keyframes,
    extract_selected_frames,
    has_ffmpeg,
)
from vid2dataset.quality import evaluate_frame
from vid2dataset.report import generate_report
from vid2dataset.resize import (
    Bucket,
    contain_resize_and_pad,
    cover_resize_and_crop,
    generate_buckets,
    longest_edge_resize,
    select_bucket,
)
from vid2dataset.scene import detect_scenes, sample_indices_for_scene
from vid2dataset.strong_dedup import (
    StrongDedupCandidate,
    make_candidate,
    select_content_diverse,
    strong_deduplicate,
)
from vid2dataset.watermark import WatermarkRegion, detect_watermarks, expand_crop_for_watermarks

log = logging.getLogger(__name__)


# ── Result types ──────────────────────────────────────────────────────


@dataclass
class FrameRecord:
    video: str
    frame_index: int
    out_path: str
    blur: float
    bucket: tuple[int, int]
    pixels: int


@dataclass
class VideoStats:
    video: str
    duration_s: float
    fps: float
    width: int
    height: int
    scenes: int
    candidates: int
    written: int
    rejected_blur: int = 0
    rejected_luma: int = 0
    rejected_too_small: int = 0
    rejected_dup: int = 0
    rejected_ssim: int = 0
    rejected_color: int = 0
    rejected_completeness: int = 0
    rejected_content: int = 0
    rejected_temporal: int = 0
    auto_blur_threshold: float | None = None
    frames_scanned: int = 0
    elapsed_s: float = 0.0
    watermarks: list[dict] = field(default_factory=list)
    records: list[FrameRecord] = field(default_factory=list)


@dataclass
class PipelineResult:
    config: ExtractConfig
    videos: list[VideoStats]
    total_written: int
    total_candidates: int
    elapsed_s: float
    contact_sheet_path: str | None = None
    html_gallery_path: str | None = None
    tagging: dict | None = None

    def to_summary_dict(self) -> dict:
        return {
            "total_written": self.total_written,
            "total_candidates": self.total_candidates,
            "elapsed_s": round(self.elapsed_s, 2),
            "contact_sheet": self.contact_sheet_path,
            "html_gallery": self.html_gallery_path,
            "tagging": self.tagging,
            "videos": [
                {
                    "video": v.video,
                    "written": v.written,
                    "candidates": v.candidates,
                    "rejected_blur": v.rejected_blur,
                    "rejected_luma": v.rejected_luma,
                    "rejected_too_small": v.rejected_too_small,
                    "rejected_dup": v.rejected_dup,
                    "rejected_ssim": v.rejected_ssim,
                    "rejected_color": v.rejected_color,
                    "rejected_completeness": v.rejected_completeness,
                    "rejected_content": v.rejected_content,
                    "rejected_temporal": v.rejected_temporal,
                    "auto_blur_threshold": v.auto_blur_threshold,
                    "frames_scanned": v.frames_scanned,
                    "elapsed_s": round(v.elapsed_s, 2),
                }
                for v in self.videos
            ],
        }


ProgressCallback = Callable[[str, int, int], None]


@dataclass(frozen=True)
class _NativeFrameCandidate:
    video: Path
    frame_pts: int
    timestamp: float
    frame_index: int
    quality: float
    fingerprint: StrongDedupCandidate


# ── Internals ─────────────────────────────────────────────────────────


def _resize_to_bucket(
    image_bgr: np.ndarray,
    cfg: ExtractConfig,
    buckets: list[Bucket],
) -> tuple[np.ndarray, Bucket] | None:
    h, w = image_bgr.shape[:2]
    if cfg.resize_mode == "longest":
        out = longest_edge_resize(image_bgr, cfg.resolution)
        oh, ow = out.shape[:2]
        return out, Bucket(width=ow, height=oh)

    bucket = select_bucket(w, h, buckets)
    if cfg.resize_mode == "cover":
        out = cover_resize_and_crop(image_bgr, bucket)
    elif cfg.resize_mode == "contain":
        out = contain_resize_and_pad(image_bgr, bucket)
    else:
        raise ValueError(f"Unknown resize_mode: {cfg.resize_mode}")
    return out, bucket


def _segments_for(cfg: ExtractConfig, video: Path) -> list[tuple[float, float]] | None:
    """Normalized (start, end) second-ranges for this video, or None = whole video."""
    segs = cfg.segments.get(video.name) or cfg.segments.get(str(video))
    if not segs:
        return None
    clean = sorted((min(a, b), max(a, b)) for a, b in segs)
    return clean or None


def _in_segments(t: float, segs: list[tuple[float, float]]) -> bool:
    return any(a <= t <= b for a, b in segs)


def process_single_frame(
    cfg: ExtractConfig,
    frame_bgr: np.ndarray,
    video: Path,
    seq: int,
) -> Path | None:
    """Crop -> bucket-resize -> write ONE manually captured frame.

    Backs the Advanced mode Capture button. Deliberately skips the quality /
    diversity / dedup gates — the user picked this exact frame. Returns the
    written path, or None when the frame can't be processed.
    """
    from vid2dataset.io_utils import write_image

    if frame_bgr is None or frame_bgr.size == 0:
        return None

    if cfg.output_mode == "native":
        out_img = frame_bgr
    else:
        buckets = generate_buckets(
            resolution=cfg.resolution,
            min_bucket=cfg.min_bucket,
            max_bucket=cfg.max_bucket,
            step=cfg.bucket_step,
        )
        if not buckets:
            return None

        if cfg.detect_letterbox:
            rect = detect_letterbox(
                frame_bgr,
                threshold=cfg.letterbox_threshold,
                min_ratio=cfg.letterbox_min_ratio,
            )
            if rect is not None:
                frame_bgr = frame_bgr[rect.y : rect.y + rect.h, rect.x : rect.x + rect.w]
        if frame_bgr.size == 0:
            return None

        resized = _resize_to_bucket(frame_bgr, cfg, buckets)
        if resized is None:
            return None
        out_img, _bucket = resized

    out_dir = _output_dir_for(cfg, video)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{sanitize_stem(video.stem)}_manual_{seq:05d}"
    out_path = out_dir / f"{stem}.{cfg.output_format}"
    write_image(
        out_img,
        out_path,
        fmt=cfg.output_format,
        jpg_quality=cfg.jpg_quality,
        webp_quality=cfg.webp_quality,
        png_compression=cfg.png_compression,
    )
    return out_path


def _kohya_subdir(cfg: ExtractConfig) -> str | None:
    """kohya-ss repeats folder name ('10_mychar'), or None when not configured.

    Only applies with flatten_output: per-video subfolders and repeats
    folders are mutually exclusive layouts.
    """
    if not (cfg.flatten_output and cfg.kohya_repeats > 0):
        return None
    trigger = " ".join(cfg.trigger_word.split())
    name = sanitize_stem(trigger) if trigger else "dataset"
    return f"{cfg.kohya_repeats}_{name}"


def _output_dir_for(cfg: ExtractConfig, video: Path) -> Path:
    sub = _kohya_subdir(cfg)
    if cfg.flatten_output:
        return cfg.output / sub if sub else cfg.output
    return cfg.output / sanitize_stem(video.stem)


def _stats_path(cfg: ExtractConfig, video: Path) -> Path:
    return _output_dir_for(cfg, video) / "_stats.json"


class _NullLock:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _process_video(
    video: Path,
    *,
    cfg: ExtractConfig,
    buckets: list[Bucket],
    dedup_index: DedupIndex | None,
    dedup_lock: threading.Lock | None = None,
    seq_offset: int,
    progress: ProgressCallback | None,
    cancel_event: threading.Event | None = None,
    hwaccel: str | None = None,
) -> VideoStats:
    """Extract frames from a single video."""
    t0 = time.perf_counter()
    meta: VideoMeta = probe_video(video)
    out_dir = _output_dir_for(cfg, video)
    out_dir.mkdir(parents=True, exist_ok=True)

    log.info(
        "Processing %s (%dx%d, %.1fs, %d frames, mode=%s)",
        video.name,
        meta.width,
        meta.height,
        meta.duration_s,
        meta.frame_count,
        cfg.decode_mode,
    )

    # Watermark scan (warn-only by default, never modifies output bytes).
    watermark_regions: list[WatermarkRegion] = []
    if cfg.detect_watermark:
        try:
            watermark_regions = detect_watermarks(video)
            for wm in watermark_regions:
                log.warning(
                    "Watermark suspected in %s at %s (%dx%d, conf=%.2f) \u2014 not cropped",
                    video.name,
                    wm.location,
                    wm.w,
                    wm.h,
                    wm.confidence,
                )
        except Exception as e:  # noqa: BLE001
            log.debug("watermark scan failed for %s: %s", video.name, e)

    # ── Auto-quality calibration ─────────────────────────────────
    effective_blur_threshold = cfg.blur_threshold
    auto_threshold = None
    if cfg.auto_quality:
        auto_threshold = auto_detect_blur_threshold(
            video,
            sample_count=50,
            keep_percentile=cfg.auto_quality_percentile,
        )
        effective_blur_threshold = auto_threshold
        log.info("Auto-quality threshold for %s: %.1f", video.name, auto_threshold)

    # ── Pick candidate indices ───────────────────────────────────
    # In keyframe+ffmpeg mode the frame source streams I-frames directly,
    # ignoring indices. So we can skip the expensive PySceneDetect pass
    # entirely. This saves ~25% of total per-video time.
    use_ffmpeg_keyframes = cfg.decode_mode == "keyframe" and has_ffmpeg()
    scenes = [] if use_ffmpeg_keyframes else detect_scenes(video, threshold=cfg.scene_threshold)

    indices: list[int] = []
    if cfg.sampling in ("scene", "hybrid"):
        for sc in scenes:
            sc_indices = sample_indices_for_scene(sc, count=cfg.frames_per_scene)
            if cfg.sampling == "hybrid" and meta.fps > 0:
                max_per_scene = max(
                    cfg.frames_per_scene,
                    int((sc.end_time - sc.start_time) / cfg.interval_seconds),
                )
                if len(sc_indices) < max_per_scene:
                    sc_indices = sample_indices_for_scene(sc, count=max_per_scene)
            indices.extend(sc_indices)
    else:  # interval
        if meta.fps > 0:
            step = max(1, int(cfg.interval_seconds * meta.fps))
            indices = list(range(0, meta.frame_count, step))

    indices = sorted(set(indices))

    # Advanced mode: restrict to the user's marked time segments.
    segments = _segments_for(cfg, video)
    if segments and meta.fps > 0:
        indices = [i for i in indices if _in_segments(i / meta.fps, segments)]

    if use_ffmpeg_keyframes:
        indices = []  # placeholder; ffmpeg path streams I-frames

    # In keyframe mode, thin out indices to approximate keyframe positions.
    # Most codecs use GOP of 60-300 frames. We keep one index per GOP-sized
    # chunk, which naturally snaps to keyframes on seek.
    if cfg.decode_mode == "keyframe" and meta.fps > 0:
        gop_estimate = max(30, int(meta.fps * 2))  # ~2 seconds
        thinned: list[int] = []
        last = -gop_estimate
        for idx in indices:
            if idx - last >= gop_estimate:
                thinned.append(idx)
                last = idx
        indices = thinned

    stats = VideoStats(
        video=str(video),
        duration_s=meta.duration_s,
        fps=meta.fps,
        width=meta.width,
        height=meta.height,
        scenes=len(scenes),
        candidates=len(indices),
        written=0,
        auto_blur_threshold=auto_threshold,
        watermarks=[wm.as_dict() for wm in watermark_regions],
    )

    # ── Diversity filters (per-video state) ──────────────────────
    use_gpu_filters = bool(cfg.gpu_accel) and is_gpu_pipeline_available()
    if cfg.ssim_filter:
        ssim_filter = (
            BatchSSIMFilter(ssim_threshold=cfg.ssim_threshold)
            if use_gpu_filters
            else DiversityFilter(ssim_threshold=cfg.ssim_threshold)
        )
    else:
        ssim_filter = None
    # Color filter: CPU is faster than GPU for our histogram-per-frame pattern
    # (GPU transfer overhead dominates for small ops). GPU SSIM still wins.
    if cfg.color_diversity:
        color_filter = ColorDiversityFilter(min_distance=cfg.color_distance)
    else:
        color_filter = None

    # Async writer: submit encode+write jobs to a small thread pool
    writer = AsyncWriter(workers=2)

    # ── Decode + filter + write ─────────────────────────────────
    seq = seq_offset
    written_for_this_video = 0
    seek_mode = cfg.decode_mode != "keyframe"

    # Bounded backup pool: top-K sharpest quality-passed frames for min guarantee.
    # Prevents unbounded memory growth on long videos. K = min_per_video * 3
    # gives selection headroom (favoring the sharpest of the sharpest).
    backup_pool_size = max(cfg.min_per_video * 3, 5) if cfg.min_per_video > 0 else 0
    # min-heap of (blur_score, frame_idx, image, bucket) - smallest blur popped first
    backup_heap: list[tuple[float, int, np.ndarray, Bucket]] = []

    effective_max = cfg.max_per_video
    effective_min = cfg.min_per_video
    if effective_max and effective_min > effective_max:
        effective_min = effective_max

    # Choose frame source: ffmpeg I-frames (fast) or OpenCV exact seek
    if cfg.decode_mode == "keyframe" and has_ffmpeg():
        # ffmpeg path: stream all keyframes, ignore indices, treat ts*fps as idx
        def _frame_source():
            try:
                for ts, fr in extract_keyframes(video, max_count=200, hwaccel=hwaccel):
                    yield int(ts * (meta.fps or 30)), fr
            except (ImportError, OSError) as e:
                log.warning("ffmpeg path failed (%s); falling back to OpenCV", e)
                yield from read_frames_at(video, indices, seek_accurate=seek_mode)

        frame_iter = _frame_source()
    else:
        frame_iter = read_frames_at(video, indices, seek_accurate=seek_mode)
    for n, (idx, frame_bgr) in enumerate(frame_iter):
        if cancel_event is not None and cancel_event.is_set():
            log.info("Cancel requested, stopping %s", video.name)
            break
        # Segment guard covers the ffmpeg keyframe stream (which ignores
        # `indices`); the OpenCV path was already filtered above.
        if segments and not _in_segments(idx / (meta.fps or 30), segments):
            continue
        if progress and (n % 4 == 0):
            progress("decode", n, len(indices) if indices else 0)

        # Letterbox crop first, optionally expanded to remove watermarks.
        if cfg.detect_letterbox or (cfg.crop_watermark and watermark_regions):
            rect = (
                detect_letterbox(
                    frame_bgr,
                    threshold=cfg.letterbox_threshold,
                    min_ratio=cfg.letterbox_min_ratio,
                )
                if cfg.detect_letterbox
                else None
            )
            base_x, base_y, base_w, base_h = (
                (rect.x, rect.y, rect.w, rect.h)
                if rect is not None
                else (0, 0, frame_bgr.shape[1], frame_bgr.shape[0])
            )
            if cfg.crop_watermark and watermark_regions:
                base_x, base_y, base_w, base_h = expand_crop_for_watermarks(
                    base_x, base_y, base_w, base_h, watermark_regions
                )
            frame_bgr = frame_bgr[base_y : base_y + base_h, base_x : base_x + base_w]

        # Quality gate.
        q = evaluate_frame(
            frame_bgr,
            blur_threshold=effective_blur_threshold,
            min_brightness=cfg.min_brightness,
            max_brightness=cfg.max_brightness,
            min_contrast=cfg.min_contrast,
        )
        if not q.passed:
            if "blur" in q.reason:
                stats.rejected_blur += 1
            else:
                stats.rejected_luma += 1
            continue

        # Completeness filter (soft: rejected frames still go to backup).
        if cfg.completeness_filter and not is_subject_complete(
            frame_bgr, min_score=cfg.completeness_threshold
        ):
            stats.rejected_completeness += 1
            continue

        # Subject size filter (soft: skip but don't lose frame).
        if cfg.subject_size_filter and not is_subject_large_enough(
            frame_bgr, min_ratio=cfg.subject_min_ratio
        ):
            stats.rejected_completeness += 1
            continue

        # Resize to bucket.
        rr = _resize_to_bucket(frame_bgr, cfg, buckets)
        if rr is None:
            stats.rejected_too_small += 1
            continue
        out_img, bucket = rr
        if bucket.pixels < cfg.min_pixels:
            stats.rejected_too_small += 1
            continue

        # Frame passed quality + resize — keep top-K sharpest as backup.
        if backup_pool_size > 0:
            entry = (q.blur_score, idx, out_img, bucket)
            if len(backup_heap) < backup_pool_size:
                heapq.heappush(backup_heap, entry)
            elif q.blur_score > backup_heap[0][0]:
                heapq.heapreplace(backup_heap, entry)

        # SSIM diversity.
        if ssim_filter is not None and not ssim_filter.is_diverse(out_img):
            stats.rejected_ssim += 1
            continue

        # Color diversity — auto-relax if too strict.
        if color_filter is not None and not color_filter.is_diverse(out_img):
            stats.rejected_color += 1
            continue

        # pHash dedup.
        h = None
        if cfg.dedup and dedup_index is not None:
            h = hash_image(out_img, hash_size=cfg.phash_size)
            with dedup_lock if dedup_lock else _NullLock():
                dup = dedup_index.is_duplicate(h)
            if dup is not None:
                stats.rejected_dup += 1
                continue

        # ── Accept frame ─────────────────────────────────────────
        seq += 1
        stem = f"{sanitize_stem(video.stem)}_{seq:05d}"
        out_path = out_dir / f"{stem}.{cfg.output_format}"
        writer.submit(
            out_img,
            out_path,
            fmt=cfg.output_format,
            jpg_quality=cfg.jpg_quality,
            webp_quality=cfg.webp_quality,
            png_compression=cfg.png_compression,
        )
        if ssim_filter is not None:
            ssim_filter.accept(out_img)
        if color_filter is not None:
            color_filter.accept(out_img)
        if cfg.dedup and dedup_index is not None and h is not None:
            with dedup_lock if dedup_lock else _NullLock():
                dedup_index.add(h, str(out_path))

        stats.records.append(
            FrameRecord(
                video=str(video),
                frame_index=idx,
                out_path=str(out_path),
                blur=q.blur_score,
                bucket=(bucket.width, bucket.height),
                pixels=bucket.pixels,
            )
        )
        stats.written += 1
        written_for_this_video += 1

        if effective_max and written_for_this_video >= effective_max:
            log.info("Reached max_per_video=%d for %s", effective_max, video.name)
            break

    # ── Min per-video guarantee ──────────────────────────────────
    # Pull from the bounded backup heap (top-K sharpest frames that passed
    # quality + resize, regardless of later diversity/dedup rejection).
    if effective_min > 0 and written_for_this_video < effective_min:
        needed = effective_min - written_for_this_video
        if effective_max:
            needed = min(needed, effective_max - written_for_this_video)
        # Sort heap entries by blur descending (sharpest first)
        written_indices = {r.frame_index for r in stats.records}
        candidates = sorted(
            (c for c in backup_heap if c[1] not in written_indices),
            key=lambda x: x[0],
            reverse=True,
        )
        added = 0
        for b_blur, b_idx, b_img, b_bucket in candidates[:needed]:
            seq += 1
            stem = f"{sanitize_stem(video.stem)}_{seq:05d}"
            out_path = out_dir / f"{stem}.{cfg.output_format}"
            writer.submit(
                b_img,
                out_path,
                fmt=cfg.output_format,
                jpg_quality=cfg.jpg_quality,
                webp_quality=cfg.webp_quality,
                png_compression=cfg.png_compression,
            )
            if cfg.dedup and dedup_index is not None:
                bh = hash_image(b_img, hash_size=cfg.phash_size)
                dedup_index.add(bh, str(out_path))
            stats.records.append(
                FrameRecord(
                    video=str(video),
                    frame_index=b_idx,
                    out_path=str(out_path),
                    blur=b_blur,
                    bucket=(b_bucket.width, b_bucket.height),
                    pixels=b_bucket.pixels,
                )
            )
            stats.written += 1
            written_for_this_video += 1
            added += 1
        if added > 0:
            log.info(
                "Min guarantee: added %d backup frames for %s",
                added,
                video.name,
            )

    writer.close()  # block until all PNG writes complete
    # In ffmpeg keyframe mode, indices was empty; record actual decoded count.
    if use_ffmpeg_keyframes and stats.candidates == 0:
        # n is the last value of enumerate; +1 for count. If no frames decoded,
        # n won't exist. Track via written + rejection counts.
        stats.candidates = (
            stats.written
            + stats.rejected_blur
            + stats.rejected_luma
            + stats.rejected_too_small
            + stats.rejected_dup
            + stats.rejected_ssim
            + stats.rejected_color
            + stats.rejected_completeness
        )
    stats.elapsed_s = time.perf_counter() - t0

    stats_path = _stats_path(cfg, video)
    stats_path.write_text(
        json.dumps(asdict(stats), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return stats


def _collect_native_candidates(
    video: Path,
    *,
    cfg: ExtractConfig,
    progress: ProgressCallback | None,
    cancel_event: threading.Event | None,
    hwaccel: str | None,
) -> tuple[VideoStats, list[_NativeFrameCandidate]]:
    """Stage one: scan every frame, then fingerprint content candidates."""
    t0 = time.perf_counter()
    meta = probe_video(video)
    out_dir = _output_dir_for(cfg, video)
    out_dir.mkdir(parents=True, exist_ok=True)
    stats = VideoStats(
        video=str(video),
        duration_s=meta.duration_s,
        fps=meta.fps,
        width=meta.width,
        height=meta.height,
        scenes=0,
        candidates=0,
        written=0,
    )
    provisional: list[_NativeFrameCandidate] = []
    log.info(
        "Native stage 1: %s (%dx%d, %d frames, proxy=%dpx)",
        video.name,
        meta.width,
        meta.height,
        meta.frame_count,
        cfg.dedup_proxy_edge,
    )
    segments = _segments_for(cfg, video)
    last_timestamp = 0.0
    for frame_pts, timestamp, proxy in extract_content_frames(
        video,
        interval_seconds=cfg.native_scan_interval_seconds,
        scene_threshold=cfg.native_scene_threshold,
        downscale_long_edge=cfg.dedup_proxy_edge,
        hwaccel=hwaccel,
    ):
        last_timestamp = timestamp
        if cancel_event is not None and cancel_event.is_set():
            break
        if segments and not _in_segments(timestamp, segments):
            continue
        stats.candidates += 1
        if progress and stats.candidates % 8 == 0:
            progress(
                "proxy",
                min(round(timestamp * (meta.fps or 0.0)), meta.frame_count),
                meta.frame_count,
            )

        analysis_frame = proxy
        if cfg.detect_letterbox:
            rect = detect_letterbox(
                proxy,
                threshold=cfg.letterbox_threshold,
                min_ratio=cfg.letterbox_min_ratio,
            )
            if rect is not None:
                analysis_frame = proxy[rect.y : rect.y + rect.h, rect.x : rect.x + rect.w]
        if analysis_frame.size == 0:
            stats.rejected_too_small += 1
            continue

        quality = evaluate_frame(
            analysis_frame,
            blur_threshold=0.0,
            min_brightness=cfg.min_brightness,
            max_brightness=cfg.max_brightness,
            min_contrast=cfg.min_contrast,
        )
        if not quality.passed:
            stats.rejected_luma += 1
            continue
        if cfg.completeness_filter and not is_subject_complete(
            analysis_frame,
            min_score=cfg.completeness_threshold,
        ):
            stats.rejected_completeness += 1
            continue
        if cfg.subject_size_filter and not is_subject_large_enough(
            analysis_frame,
            min_ratio=cfg.subject_min_ratio,
        ):
            stats.rejected_completeness += 1
            continue

        provisional.append(
            _NativeFrameCandidate(
                video=video,
                frame_pts=frame_pts,
                timestamp=timestamp,
                frame_index=round(timestamp * (meta.fps or 30.0)),
                quality=quality.blur_score,
                fingerprint=make_candidate(
                    analysis_frame,
                    quality=quality.blur_score,
                    group=str(video),
                ),
            )
        )

    if cfg.auto_quality and provisional:
        accepted_indices, thresholds = _adaptive_quality_indices(
            [
                (index, candidate.timestamp, candidate.quality)
                for index, candidate in enumerate(provisional)
            ],
            blur_floor=cfg.blur_threshold,
            keep_percentile=cfg.auto_quality_percentile,
            window_seconds=cfg.auto_quality_window_seconds,
        )
        accepted = [
            candidate
            for index, candidate in enumerate(provisional)
            if index in accepted_indices
        ]
        stats.auto_blur_threshold = float(np.mean(thresholds))
        log.info(
            "Native auto-quality for %s: %d proxy frames -> %d retained "
            "(windows=%d, threshold %.2f..%.2f)",
            video.name,
            len(provisional),
            len(accepted),
            len(thresholds),
            min(thresholds),
            max(thresholds),
        )
    else:
        accepted = [
            candidate
            for candidate in provisional
            if candidate.quality >= cfg.blur_threshold
        ]
    stats.rejected_blur += len(provisional) - len(accepted)
    cancelled = cancel_event is not None and cancel_event.is_set()
    stats.frames_scanned = (
        min(round(last_timestamp * (meta.fps or 0.0)), meta.frame_count)
        if cancelled
        else meta.frame_count
    )
    if progress and not cancelled:
        progress("proxy", meta.frame_count, meta.frame_count)
    log.info(
        "Native full-frame scan for %s: %d/%d source frames -> %d content candidates",
        video.name,
        stats.frames_scanned,
        meta.frame_count,
        stats.candidates,
    )
    stats.elapsed_s = time.perf_counter() - t0
    return stats, accepted


def _write_native_winners(
    *,
    cfg: ExtractConfig,
    candidates: list[_NativeFrameCandidate],
    keep_indices: list[int],
    stats_by_video: dict[Path, VideoStats],
    hwaccel: str | None,
    progress: ProgressCallback | None,
    cancel_event: threading.Event | None,
) -> None:
    """Stage two: decode only winners and write source-resolution images."""
    winners = [candidates[index] for index in keep_indices]
    by_video: dict[Path, list[_NativeFrameCandidate]] = {}
    for candidate in winners:
        by_video.setdefault(candidate.video, []).append(candidate)

    total = len(winners)
    written = 0
    writer = AsyncWriter(workers=max(2, min(8, (cfg.workers or 4))))
    try:
        for video, video_winners in by_video.items():
            if cancel_event is not None and cancel_event.is_set():
                break
            ordered = sorted(video_winners, key=lambda candidate: candidate.timestamp)
            candidate_by_pts = {
                candidate.frame_pts: candidate for candidate in ordered
            }
            stats = stats_by_video[video]
            out_dir = _output_dir_for(cfg, video)
            log.info(
                "Native stage 2: decoding %d winners from %s at %dx%d",
                len(ordered),
                video.name,
                stats.width,
                stats.height,
            )
            for frame_pts, frame in extract_selected_frames(
                video,
                [candidate.frame_pts for candidate in ordered],
                hwaccel=hwaccel,
            ):
                if cancel_event is not None and cancel_event.is_set():
                    break
                candidate = candidate_by_pts[frame_pts]
                seq = stats.written + 1
                stem = f"{sanitize_stem(video.stem)}_{seq:05d}"
                out_path = out_dir / f"{stem}.{cfg.output_format}"
                writer.submit(
                    frame,
                    out_path,
                    fmt=cfg.output_format,
                    jpg_quality=cfg.jpg_quality,
                    webp_quality=cfg.webp_quality,
                    png_compression=cfg.png_compression,
                )
                stats.records.append(
                    FrameRecord(
                        video=str(video),
                        frame_index=candidate.frame_index,
                        out_path=str(out_path),
                        blur=candidate.quality,
                        bucket=(stats.width, stats.height),
                        pixels=stats.width * stats.height,
                    )
                )
                stats.written += 1
                written += 1
                if progress:
                    progress("native-write", written, total)
    finally:
        writer.close()


def _adaptive_quality_indices(
    entries: list[tuple[int, float, float]],
    *,
    blur_floor: float,
    keep_percentile: float,
    window_seconds: float,
) -> tuple[set[int], list[float]]:
    """Choose locally sharp candidates without sacrificing timeline coverage."""
    if not entries:
        return set(), []

    groups: dict[int, list[tuple[int, float, float]]] = {}
    for entry in entries:
        group = int(entry[1] // window_seconds) if window_seconds > 0 else 0
        groups.setdefault(group, []).append(entry)

    accepted: set[int] = set()
    thresholds: list[float] = []
    for group_entries in groups.values():
        scores = np.asarray([entry[2] for entry in group_entries])
        threshold = max(
            blur_floor,
            float(np.percentile(scores, 100.0 - keep_percentile)),
        )
        thresholds.append(threshold)
        accepted.update(entry[0] for entry in group_entries if entry[2] >= threshold)
    return accepted, thresholds


def _temporal_features_match(
    left: tuple,
    right: tuple,
    *,
    threshold: float,
) -> bool:
    if len(left) < 4 or len(right) < 4:
        return True
    left_fingerprint = left[3]
    right_fingerprint = right[3]
    similarity = float(np.dot(left_fingerprint.feature, right_fingerprint.feature))
    return similarity >= threshold


def _select_temporal_winners(
    entries: list[tuple],
    *,
    min_seconds: float,
    max_count: int | None,
    feature_threshold: float = 1.0,
) -> list[int]:
    """Keep timeline coverage while suppressing only similar nearby content.

    Entries are ``(candidate_index, timestamp, quality[, fingerprint])``.
    Candidates only compete with visually similar retained frames inside the
    temporal neighbourhood. If an explicit hard cap remains necessary, it is
    distributed across the timeline.
    """
    if not entries:
        return []

    ranked = sorted(entries, key=lambda item: (-item[2], item[1], item[0]))
    retained: list[tuple] = []
    retained_times: list[float] = []
    for entry in ranked:
        timestamp = entry[1]
        position = int(np.searchsorted(retained_times, timestamp))
        nearby: list[tuple] = []
        left = position - 1
        while left >= 0 and timestamp - retained_times[left] < min_seconds:
            nearby.append(retained[left])
            left -= 1
        right = position
        while right < len(retained_times) and retained_times[right] - timestamp < min_seconds:
            nearby.append(retained[right])
            right += 1
        if min_seconds <= 0 or not any(
            _temporal_features_match(entry, other, threshold=feature_threshold)
            for other in nearby
        ):
            retained_times.insert(position, timestamp)
            retained.insert(position, entry)

    if not max_count or len(retained) <= max_count:
        return sorted(entry[0] for entry in retained)

    start = retained[0][1]
    end = retained[-1][1]
    if end <= start:
        return sorted(entry[0] for entry in ranked[:max_count])

    bin_width = (end - start) / max_count
    best_by_bin: dict[int, tuple[int, float, float]] = {}
    for entry in retained:
        bin_index = min(max_count - 1, int((entry[1] - start) / bin_width))
        current = best_by_bin.get(bin_index)
        if current is None or (entry[2], -entry[1]) > (current[2], -current[1]):
            best_by_bin[bin_index] = entry

    chosen = {entry[0] for entry in best_by_bin.values()}
    for entry in sorted(retained, key=lambda item: (-item[2], item[1], item[0])):
        if len(chosen) >= max_count:
            break
        chosen.add(entry[0])
    return sorted(chosen)


def _run_native_pipeline(
    cfg: ExtractConfig,
    videos: list[Path],
    *,
    progress: ProgressCallback | None,
    cancel_event: threading.Event | None,
    hwaccel: str | None,
) -> tuple[list[VideoStats], float]:
    """Run the native-resolution two-stage extraction path."""
    if cfg.output_format != "png":
        log.warning(
            "Native mode output_format=%s is not lossless; use PNG for lossless output",
            cfg.output_format,
        )
    todo = [
        video
        for video in videos
        if not (cfg.skip_existing and _stats_path(cfg, video).exists())
    ]
    start = time.perf_counter()
    stats_by_video: dict[Path, VideoStats] = {}
    candidates: list[_NativeFrameCandidate] = []
    if todo:
        override = cfg.workers if cfg.workers and cfg.workers > 0 else None
        workers, reason = auto_detect_workers(todo, user_override=override)
        workers = min(workers, 4)
        log.info("Native proxy workers: %d (%s)", workers, reason)
    else:
        workers = 1

    def collect(video: Path):
        return _collect_native_candidates(
            video,
            cfg=cfg,
            progress=progress,
            cancel_event=cancel_event,
            hwaccel=hwaccel,
        )

    if workers <= 1 or len(todo) <= 1:
        collected = [(video, collect(video)) for video in todo]
    else:
        collected = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(collect, video): video for video in todo}
            for future in as_completed(futures):
                collected.append((futures[future], future.result()))
    for video, (stats, video_candidates) in collected:
        stats_by_video[video] = stats
        candidates.extend(video_candidates)

    fingerprints = [candidate.fingerprint for candidate in candidates]
    if cfg.dedup and cfg.dedup_mode == "strong":
        if progress:
            progress("strong-dedup", 0, len(candidates))
        result = strong_deduplicate(
            fingerprints,
            phash_distance=cfg.dedup_phash_distance,
            feature_threshold=cfg.dedup_feature_threshold,
            ssim_threshold=cfg.dedup_strong_ssim_threshold,
            scope=cfg.dedup_scope,
            keep=cfg.dedup_keep,
            use_gpu=cfg.gpu_accel,
        )
        keep_indices = result.keep_indices
        for duplicate_index in result.duplicate_of:
            stats_by_video[candidates[duplicate_index].video].rejected_dup += 1
        log.info(
            "Strong dedup retained %d/%d candidates (device=%s)",
            len(keep_indices),
            len(candidates),
            result.device,
        )
        if progress:
            progress("strong-dedup", len(candidates), len(candidates))
    else:
        keep_indices = list(range(len(candidates)))

    selected: list[int] = []
    grouped: dict[Path, list[int]] = {}
    for index in keep_indices:
        grouped.setdefault(candidates[index].video, []).append(index)
    for video, indexes in grouped.items():
        content_result = select_content_diverse(
            [candidates[index].fingerprint for index in indexes],
            threshold=cfg.dedup_content_threshold,
            use_gpu=cfg.gpu_accel,
        )
        content_indexes = [indexes[index] for index in content_result.keep_indices]
        stats_by_video[video].rejected_content += len(indexes) - len(content_indexes)
        video_selected = _select_temporal_winners(
            [
                (
                    index,
                    candidates[index].timestamp,
                    candidates[index].quality,
                    candidates[index].fingerprint,
                )
                for index in content_indexes
            ],
            min_seconds=cfg.dedup_min_seconds,
            max_count=cfg.max_per_video,
            feature_threshold=cfg.dedup_temporal_feature_threshold,
        )
        rejected = len(content_indexes) - len(video_selected)
        stats_by_video[video].rejected_temporal += rejected
        selected.extend(video_selected)
        if rejected:
            log.info(
                "Temporal diversity retained %d/%d candidates for %s "
                "(minimum %.2fs, cap=%s)",
                len(video_selected),
                len(content_indexes),
                video.name,
                cfg.dedup_min_seconds,
                cfg.max_per_video or "none",
            )
    keep_indices = sorted(selected)

    _write_native_winners(
        cfg=cfg,
        candidates=candidates,
        keep_indices=keep_indices,
        stats_by_video=stats_by_video,
        hwaccel=hwaccel,
        progress=progress,
        cancel_event=cancel_event,
    )
    for video, stats in stats_by_video.items():
        stats.elapsed_s = time.perf_counter() - start
        _stats_path(cfg, video).write_text(
            json.dumps(asdict(stats), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    return list(stats_by_video.values()), time.perf_counter() - start


# ── Public entry point ────────────────────────────────────────────────


def run_pipeline(
    cfg: ExtractConfig,
    *,
    progress: ProgressCallback | None = None,
    cancel_event: threading.Event | None = None,
) -> PipelineResult:
    """Extract a training set from one video or a directory of videos."""
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    videos = discover_videos(cfg.input)
    if not videos:
        raise RuntimeError(f"No videos found under {cfg.input}")

    cfg.output.mkdir(parents=True, exist_ok=True)

    # GPU acceleration probe: validate once before processing.
    # Log GPU pipeline state
    if cfg.gpu_accel:
        from vid2dataset.gpu_filters import device_summary

        log.info("%s", device_summary())

    selected_hwaccel: str | None = None
    if cfg.gpu_accel and has_ffmpeg():
        sample_videos = discover_videos(cfg.input)
        if sample_videos:
            log.info("Probing GPU acceleration on sample video...")
            selected_hwaccel = auto_select_hwaccel(sample_videos[0])
            if selected_hwaccel:
                log.info("FFmpeg hardware video decoding: %s", selected_hwaccel)
            else:
                log.warning(
                    "No compatible FFmpeg hardware decoder validated; "
                    "video decoding uses CPU (GPU filters remain enabled when available)"
                )

    if cfg.output_mode == "native":
        log.info(
            "Native lossless pipeline enabled: full-frame scan <= %.3fs, "
            "scene=%.3f, proxy=%d, dedup=%s/%s, PNG compression=%d",
            cfg.native_scan_interval_seconds,
            cfg.native_scene_threshold,
            cfg.dedup_proxy_edge,
            cfg.dedup_mode,
            cfg.dedup_scope,
            cfg.png_compression,
        )
        all_stats, elapsed = _run_native_pipeline(
            cfg,
            videos,
            progress=progress,
            cancel_event=cancel_event,
            hwaccel=selected_hwaccel,
        )
    else:
        buckets = generate_buckets(
            resolution=cfg.resolution,
            min_bucket=cfg.min_bucket,
            max_bucket=cfg.max_bucket,
            step=cfg.bucket_step,
        )
        if not buckets:
            raise RuntimeError("No valid buckets — check resolution/min_bucket/max_bucket/step.")

        dedup_index = (
            DedupIndex.load_or_new(
                cfg.dedup_index, hash_size=cfg.phash_size, distance=cfg.phash_distance
            )
            if cfg.dedup
            else None
        )

        t_start = time.perf_counter()
        all_stats = []
        dedup_lock = threading.Lock() if dedup_index else None

        todo = []
        for video in videos:
            if cfg.skip_existing and _stats_path(cfg, video).exists():
                log.info("Skip (already done): %s", video.name)
                continue
            todo.append(video)

        completed = 0
        if todo:
            override = cfg.workers if cfg.workers and cfg.workers > 0 else None
            n_workers, worker_reason = auto_detect_workers(todo, user_override=override)
            log.info("Workers: %s", worker_reason)
        else:
            n_workers = 1

        def _process_one(video: Path, seq_off: int) -> VideoStats | None:
            if cancel_event and cancel_event.is_set():
                return None
            try:
                return _process_video(
                    video,
                    cfg=cfg,
                    buckets=buckets,
                    dedup_index=dedup_index,
                    dedup_lock=dedup_lock,
                    seq_offset=seq_off,
                    progress=progress,
                    cancel_event=cancel_event,
                    hwaccel=selected_hwaccel,
                )
            except (cv2.error, OSError, ValueError) as e:
                log.error("Failed to process %s: %s", video.name, e)
                return None

        if n_workers <= 1 or len(todo) <= 1:
            seq_offset = 0
            for vi, video in enumerate(todo):
                if cancel_event and cancel_event.is_set():
                    log.info("Cancelled by user")
                    break
                if progress:
                    progress("video", vi, len(todo))
                vs = _process_one(video, seq_offset)
                if vs is None:
                    continue
                all_stats.append(vs)
                seq_offset += vs.written
                if dedup_index and cfg.dedup_index:
                    with dedup_lock:
                        dedup_index.save(cfg.dedup_index)
        else:
            log.info("Parallel processing with %d workers", n_workers)
            with ThreadPoolExecutor(max_workers=n_workers) as pool:
                future_to_video = {
                    pool.submit(_process_one, video, vi * 100000): video
                    for vi, video in enumerate(todo)
                }
                for future in as_completed(future_to_video):
                    if cancel_event and cancel_event.is_set():
                        pool.shutdown(wait=False, cancel_futures=True)
                        log.info("Cancelled by user")
                        break
                    vs = future.result()
                    completed += 1
                    if progress:
                        progress("video", completed, len(todo))
                    if vs is None:
                        continue
                    all_stats.append(vs)
                    if dedup_index and cfg.dedup_index:
                        with dedup_lock:
                            dedup_index.save(cfg.dedup_index)
        elapsed = time.perf_counter() - t_start

    all_image_paths = [Path(r.out_path) for vs in all_stats for r in vs.records]

    # ── Auto-tagging (optional post-pipeline pass) ────────────────
    # Lazy import keeps the extraction core independent of the tagger
    # module; a tagging failure must never kill an otherwise good run.
    tag_info: dict | None = None
    tag_per_image: dict[str, list[str]] = {}
    if cfg.tag_images and all_image_paths and not (cancel_event and cancel_event.is_set()):
        try:
            from vid2dataset.tagger import tag_folder

            ts = tag_folder(
                cfg.output,
                model_name=cfg.tagger_model,
                trigger_word=cfg.trigger_word,
                general_threshold=cfg.tag_general_threshold,
                character_threshold=cfg.tag_character_threshold,
                blacklist=cfg.tag_blacklist,
                always=cfg.tag_always,
                trait_prune_threshold=cfg.trait_prune_threshold,
                require=cfg.tag_require,
                exclude=cfg.tag_exclude,
                progress_cb=(
                    (lambda stage, done, total: progress(f"tag:{stage}", done, total))
                    if progress
                    else None
                ),
                cancel_event=cancel_event,
            )
            tag_per_image = ts.per_image
            tag_info = {
                "tagged": ts.tagged,
                "failed": ts.failed,
                "total": ts.total,
                "cancelled": ts.cancelled,
                "trigger_word": " ".join(cfg.trigger_word.split()),
                "model": cfg.tagger_model,
                "top_tags": ts.tag_counts.most_common(30),
                "rejected_by_tags": len(ts.rejected),
                "pruned_tags": ts.pruned_tags,
            }
            if ts.rejected:
                # Rejected images were moved to _rejected/ — drop them from
                # the gallery / contact sheet inputs so links stay live.
                rejected_abs = {(cfg.output / r).resolve() for r in ts.rejected}
                all_image_paths = [p for p in all_image_paths if p.resolve() not in rejected_abs]
            log.info(
                "Tagged %d/%d images (%d failed, %d rejected by tag rules)",
                ts.tagged,
                ts.total,
                ts.failed,
                len(ts.rejected),
            )
        except Exception as e:  # noqa: BLE001
            log.error("Tagging pass failed: %s", e)
            tag_info = {"error": str(e)}

    # ── Gallery generation ───────────────────────────────────────
    cs_path = None
    html_path = None

    if cfg.contact_sheet and all_image_paths:
        cs = generate_contact_sheet(all_image_paths, cfg.output / "_contact_sheet.png")
        cs_path = str(cs) if cs else None

    if cfg.html_gallery and all_image_paths:
        # Build metadata: per-output-path dict of blur/bucket/frame info
        gallery_meta: dict[Path, dict] = {}
        for vs in all_stats:
            for r in vs.records:
                gallery_meta[Path(r.out_path)] = {
                    "blur": r.blur,
                    "bucket": list(r.bucket),
                    "frame_index": r.frame_index,
                    "video": vs.video,
                }
        if tag_per_image:
            out_root = cfg.output.resolve()
            for p, meta in gallery_meta.items():
                try:
                    rel = p.resolve().relative_to(out_root).as_posix()
                except ValueError:
                    continue
                tags = tag_per_image.get(rel)
                if tags:
                    meta["tags"] = tags
        hg = generate_html_gallery(
            all_image_paths,
            cfg.output / "_gallery.html",
            metadata=gallery_meta,
        )
        html_path = str(hg) if hg else None

    # Pre-flight report (purely additive: doesn't touch the images).
    try:
        # Build a richer summary that includes records for histograms
        report_summary = {
            "total_written": sum(v.written for v in all_stats),
            "total_candidates": sum(v.candidates for v in all_stats),
            "elapsed_s": elapsed,
            "videos": [
                {
                    "video": v.video,
                    "written": v.written,
                    "candidates": v.candidates,
                    "rejected_blur": v.rejected_blur,
                    "rejected_ssim": v.rejected_ssim,
                    "rejected_color": v.rejected_color,
                    "rejected_dup": v.rejected_dup,
                    "rejected_content": v.rejected_content,
                    "rejected_temporal": v.rejected_temporal,
                    "frames_scanned": v.frames_scanned,
                    "elapsed_s": v.elapsed_s,
                    "watermarks": v.watermarks,
                    "records": [{"blur": r.blur, "bucket": list(r.bucket)} for r in v.records],
                }
                for v in all_stats
            ],
        }
        if tag_info is not None:
            report_summary["tagging"] = tag_info
        generate_report(report_summary, cfg.output / "_report.html")
    except Exception as e:  # noqa: BLE001
        log.debug("report generation failed: %s", e)

    result = PipelineResult(
        config=cfg,
        videos=all_stats,
        total_written=sum(v.written for v in all_stats),
        total_candidates=sum(v.candidates for v in all_stats),
        elapsed_s=elapsed,
        contact_sheet_path=cs_path,
        html_gallery_path=html_path,
        tagging=tag_info,
    )

    summary_path = cfg.output / "_run_summary.json"
    summary_path.write_text(
        json.dumps(result.to_summary_dict(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info(
        "Done: %d images written across %d videos in %.1fs",
        result.total_written,
        len(all_stats),
        elapsed,
    )
    return result
