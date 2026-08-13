"""Strong global deduplication tests."""

from __future__ import annotations

import cv2
import numpy as np

from vid2dataset.extractor import _adaptive_quality_indices, _select_temporal_winners
from vid2dataset.strong_dedup import (
    _phash_pairs,
    make_candidate,
    select_content_diverse,
    strong_deduplicate,
)


def _pattern(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    image = rng.integers(0, 256, (240, 320, 3), dtype=np.uint8)
    cv2.rectangle(image, (50, 40), (250, 200), (20, 220, 80), 8)
    return image


def test_strong_dedup_keeps_sharpest_duplicate() -> None:
    image = _pattern(1)
    different = _pattern(2)
    candidates = [
        make_candidate(image, quality=100.0, group="a"),
        make_candidate(image.copy(), quality=180.0, group="a"),
        make_candidate(different, quality=120.0, group="a"),
    ]

    result = strong_deduplicate(
        candidates,
        phash_distance=4,
        feature_threshold=0.985,
        ssim_threshold=0.94,
        scope="global",
        keep="sharpest",
        use_gpu=False,
    )

    assert result.keep_indices == [1, 2]
    assert result.duplicate_of == {0: 1}


def test_video_scope_does_not_merge_across_sources() -> None:
    image = _pattern(3)
    candidates = [
        make_candidate(image, quality=100.0, group="a"),
        make_candidate(image.copy(), quality=180.0, group="b"),
    ]

    result = strong_deduplicate(
        candidates,
        phash_distance=4,
        feature_threshold=0.985,
        ssim_threshold=0.94,
        scope="video",
        keep="sharpest",
        use_gpu=False,
    )

    assert result.keep_indices == [0, 1]
    assert result.duplicate_of == {}


def test_video_scope_limits_phash_neighbors_after_group_filtering() -> None:
    image = _pattern(4)
    candidates = [
        make_candidate(image, quality=100.0, group="target"),
        *[
            make_candidate(image, quality=100.0, group=f"other-{index}")
            for index in range(70)
        ],
        make_candidate(image, quality=90.0, group="target"),
    ]

    pairs = _phash_pairs(
        candidates,
        distance=0,
        scope="video",
        max_neighbors=64,
    )

    assert (0, len(candidates) - 1) in pairs


def test_temporal_selection_keeps_sharpest_local_winner() -> None:
    entries = [
        (0, 0.0, 10.0),
        (1, 0.5, 30.0),
        (2, 1.0, 20.0),
        (3, 2.5, 15.0),
        (4, 3.0, 40.0),
    ]

    selected = _select_temporal_winners(
        entries,
        min_seconds=2.0,
        max_count=None,
    )

    assert selected == [1, 4]


def test_temporal_cap_distributes_winners_across_timeline() -> None:
    entries = [
        (index, float(index), 1000.0 - abs(index - 10))
        for index in range(100)
    ]

    selected = _select_temporal_winners(
        entries,
        min_seconds=0.0,
        max_count=5,
    )
    timestamps = [entries[index][1] for index in selected]

    assert len(selected) == 5
    assert min(timestamps) < 20
    assert max(timestamps) >= 80


def test_adaptive_quality_keeps_softer_valid_ending() -> None:
    entries = [
        (0, 0.0, 120.0),
        (1, 5.0, 100.0),
        (2, 20.0, 60.0),
        (3, 25.0, 55.0),
    ]

    accepted, thresholds = _adaptive_quality_indices(
        entries,
        blur_floor=50.0,
        keep_percentile=60.0,
        window_seconds=20.0,
    )

    assert accepted == {0, 2}
    assert thresholds[0] > thresholds[1]


def test_temporal_selection_keeps_distinct_nearby_content() -> None:
    first = make_candidate(_pattern(10), quality=100.0, group="a")
    similar = make_candidate(_pattern(10), quality=90.0, group="a")
    distinct = make_candidate(_pattern(11), quality=80.0, group="a")
    selected = _select_temporal_winners(
        [
            (0, 0.0, 100.0, first),
            (1, 1.0, 90.0, similar),
            (2, 2.0, 80.0, distinct),
        ],
        min_seconds=4.0,
        max_count=None,
        feature_threshold=0.94,
    )

    assert selected == [0, 2]


def test_adaptive_quality_covers_each_usable_window() -> None:
    accepted, _thresholds = _adaptive_quality_indices(
        [(0, 1.0, 100.0), (1, 21.0, 80.0), (2, 41.0, 60.0)],
        blur_floor=50.0,
        keep_percentile=60.0,
        window_seconds=20.0,
    )

    assert accepted == {0, 1, 2}


def test_content_diversity_is_global_and_keeps_sharpest() -> None:
    repeated = _pattern(20)
    distinct = _pattern(21)
    candidates = [
        make_candidate(repeated, quality=80.0, group="a"),
        make_candidate(distinct, quality=90.0, group="a"),
        make_candidate(repeated.copy(), quality=120.0, group="a"),
    ]

    result = select_content_diverse(candidates, threshold=0.80, use_gpu=False)

    assert result.keep_indices == [1, 2]


def test_content_diversity_zero_disables_stage() -> None:
    candidates = [
        make_candidate(_pattern(30), quality=100.0, group="a"),
        make_candidate(_pattern(30), quality=90.0, group="a"),
    ]

    result = select_content_diverse(candidates, threshold=0.0, use_gpu=False)

    assert result.keep_indices == [0, 1]
