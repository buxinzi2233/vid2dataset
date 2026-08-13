"""Perceptual deduplication for native-resolution extraction."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import imagehash
import numpy as np
from PIL import Image

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class StrongDedupCandidate:
    phash: int
    feature: np.ndarray
    gray: np.ndarray
    quality: float
    group: str


@dataclass(frozen=True)
class StrongDedupResult:
    keep_indices: list[int]
    duplicate_of: dict[int, int]
    device: str
    compared_pairs: int


@dataclass(frozen=True)
class ContentDiversityResult:
    keep_indices: list[int]
    device: str


class _UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        a = self.find(left)
        b = self.find(right)
        if a != b:
            self.parent[b] = a


def _device(use_gpu: bool):
    try:
        import torch
    except ImportError:
        return None, "cpu"
    if use_gpu and torch.cuda.is_available():
        return torch, "cuda"
    if use_gpu and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch, "mps"
    return torch, "cpu"


def make_candidate(
    proxy_bgr: np.ndarray,
    *,
    quality: float,
    group: str,
) -> StrongDedupCandidate:
    """Compress one proxy into the fingerprints retained for global matching."""
    small = cv2.resize(proxy_bgr, (64, 64), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    luma = lab[:, :, 0]
    luma = (luma - luma.mean()) / max(float(luma.std()), 1.0)
    color = cv2.resize(lab[:, :, 1:], (16, 16), interpolation=cv2.INTER_AREA)
    color = (color - 128.0) / 64.0
    feature = np.concatenate((luma.reshape(-1), color.reshape(-1)))
    feature /= max(float(np.linalg.norm(feature)), 1e-6)

    gray = cv2.cvtColor(proxy_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (128, 128), interpolation=cv2.INTER_AREA).astype(np.float32)
    rgb = proxy_bgr[:, :, ::-1]
    phash = int(str(imagehash.phash(Image.fromarray(rgb), hash_size=8)), 16)
    return StrongDedupCandidate(
        phash=phash,
        feature=feature.astype(np.float32),
        gray=gray,
        quality=quality,
        group=group,
    )


def _feature_pairs(
    features: np.ndarray,
    *,
    threshold: float,
    groups: list[str],
    scope: str,
    use_gpu: bool,
    block_size: int = 1024,
    max_neighbors: int = 64,
) -> tuple[set[tuple[int, int]], str]:
    torch, device = _device(use_gpu)
    if torch is None or device == "cpu":
        similarity = features @ features.T
        if scope == "video":
            group_array = np.asarray(groups)
            similarity[group_array[:, None] != group_array[None, :]] = -1.0
        pairs: set[tuple[int, int]] = set()
        for left, row in enumerate(similarity):
            eligible = np.flatnonzero(row[left + 1 :] >= threshold) + left + 1
            if len(eligible) > max_neighbors:
                scores = row[eligible]
                chosen = np.argpartition(scores, -max_neighbors)[-max_neighbors:]
                eligible = eligible[chosen]
            for right in eligible.tolist():
                if scope != "video" or groups[left] == groups[right]:
                    pairs.add((left, right))
        return pairs, "cpu"
    tensor = torch.from_numpy(features).to(device)
    group_ids = None
    if scope == "video":
        group_lookup = {group: index for index, group in enumerate(dict.fromkeys(groups))}
        group_ids = torch.tensor(
            [group_lookup[group] for group in groups],
            device=device,
        )
    pairs: set[tuple[int, int]] = set()
    for start in range(0, len(features), block_size):
        end = min(start + block_size, len(features))
        similarity = tensor[start:end] @ tensor.T
        if group_ids is not None:
            similarity.masked_fill_(
                group_ids[start:end, None] != group_ids[None, :],
                -1.0,
            )
        values, indices = similarity.topk(
            min(max_neighbors + 1, similarity.shape[1]),
            dim=1,
        )
        values = values.cpu().numpy()
        indices = indices.cpu().numpy()
        for local_left in range(end - start):
            left = start + local_left
            added = 0
            for score, raw_right in zip(
                values[local_left], indices[local_left], strict=True
            ):
                right = int(raw_right)
                if score < threshold or right <= left:
                    continue
                if scope == "video" and groups[left] != groups[right]:
                    continue
                pairs.add((left, right))
                added += 1
                if added >= max_neighbors:
                    break
        del similarity
    if device == "cuda":
        torch.cuda.empty_cache()
    del tensor
    del group_ids
    return pairs, device


def _phash_pairs(
    candidates: list[StrongDedupCandidate],
    *,
    distance: int,
    scope: str,
    block_size: int = 1024,
    max_neighbors: int = 64,
) -> set[tuple[int, int]]:
    hashes = np.asarray([candidate.phash for candidate in candidates], dtype=np.uint64)
    pairs: set[tuple[int, int]] = set()
    for start in range(0, len(hashes), block_size):
        end = min(start + block_size, len(hashes))
        distances = np.bitwise_count(hashes[start:end, None] ^ hashes[None, :])
        for local_left, row in enumerate(distances):
            left = start + local_left
            eligible = np.flatnonzero(row[left + 1 :] <= distance) + left + 1
            if scope == "video":
                eligible = np.asarray(
                    [
                        right
                        for right in eligible.tolist()
                        if candidates[left].group == candidates[right].group
                    ]
                )
            for right in eligible[:max_neighbors].tolist():
                pairs.add((left, right))
    return pairs


def _ssim_pairs(
    grays: np.ndarray,
    pairs: list[tuple[int, int]],
    *,
    use_gpu: bool,
    batch_size: int = 4096,
) -> tuple[np.ndarray, str]:
    if not pairs:
        return np.empty((0,), dtype=np.float32), "cpu"
    torch, device = _device(use_gpu)
    if torch is None or device == "cpu":
        scores = []
        c1 = (0.01 * 255) ** 2
        c2 = (0.03 * 255) ** 2
        for left, right in pairs:
            a, b = grays[left], grays[right]
            ma, mb = float(a.mean()), float(b.mean())
            sa, sb = float(a.std()), float(b.std())
            cov = float(((a - ma) * (b - mb)).mean())
            scores.append(
                ((2 * ma * mb + c1) * (2 * cov + c2))
                / ((ma * ma + mb * mb + c1) * (sa * sa + sb * sb + c2))
            )
        return np.asarray(scores, dtype=np.float32), "cpu"

    gray_tensor = torch.from_numpy(grays).to(device)
    chunks = []
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    for start in range(0, len(pairs), batch_size):
        chunk = pairs[start : start + batch_size]
        left_idx = torch.tensor([a for a, _ in chunk], device=device)
        right_idx = torch.tensor([b for _, b in chunk], device=device)
        a = gray_tensor[left_idx]
        b = gray_tensor[right_idx]
        ma = a.mean(dim=(1, 2))
        mb = b.mean(dim=(1, 2))
        sa = a.std(dim=(1, 2), unbiased=False)
        sb = b.std(dim=(1, 2), unbiased=False)
        cov = ((a - ma[:, None, None]) * (b - mb[:, None, None])).mean(dim=(1, 2))
        score = ((2 * ma * mb + c1) * (2 * cov + c2)) / (
            (ma.square() + mb.square() + c1) * (sa.square() + sb.square() + c2)
        )
        chunks.append(score.float().cpu().numpy())
    del gray_tensor
    if device == "cuda":
        torch.cuda.empty_cache()
    return np.concatenate(chunks), device


def strong_deduplicate(
    candidates: list[StrongDedupCandidate],
    *,
    phash_distance: int,
    feature_threshold: float,
    ssim_threshold: float,
    scope: str,
    keep: str,
    use_gpu: bool,
) -> StrongDedupResult:
    """Cluster near-identical proxy frames and choose one winner per cluster."""
    if len(candidates) < 2:
        return StrongDedupResult(list(range(len(candidates))), {}, "cpu", 0)

    features = np.stack([candidate.feature for candidate in candidates])
    feature_pairs, feature_device = _feature_pairs(
        features,
        threshold=feature_threshold,
        groups=[candidate.group for candidate in candidates],
        scope=scope,
        use_gpu=use_gpu,
    )
    pairs = sorted(
        feature_pairs | _phash_pairs(candidates, distance=phash_distance, scope=scope)
    )

    grays = np.stack([candidate.gray for candidate in candidates])
    ssim_scores, ssim_device = _ssim_pairs(grays, pairs, use_gpu=use_gpu)
    union = _UnionFind(len(candidates))
    for pair, score in zip(pairs, ssim_scores, strict=True):
        if score >= ssim_threshold:
            union.union(*pair)

    clusters: dict[int, list[int]] = {}
    for index in range(len(candidates)):
        clusters.setdefault(union.find(index), []).append(index)

    winners: list[int] = []
    duplicate_of: dict[int, int] = {}
    for members in clusters.values():
        if keep == "sharpest":
            winner = max(members, key=lambda index: (candidates[index].quality, -index))
        else:
            winner = min(members)
        winners.append(winner)
        for member in members:
            if member != winner:
                duplicate_of[member] = winner
    winners.sort()
    device = ssim_device if pairs else feature_device
    log.info(
        "Strong dedup: %d candidates -> %d clusters, %d pairs confirmed on %s",
        len(candidates),
        len(winners),
        len(pairs),
        device,
    )
    return StrongDedupResult(winners, duplicate_of, device, len(pairs))


def select_content_diverse(
    candidates: list[StrongDedupCandidate],
    *,
    threshold: float,
    use_gpu: bool,
) -> ContentDiversityResult:
    """Keep a quality-first maximal set of spatially distinct compositions.

    Unlike near-duplicate clustering, this stage deliberately does not require
    high SSIM: repeated compositions with incremental pose/camera motion should
    compete across the complete video. There is no target count or time quota.
    """
    if threshold <= 0.0 or len(candidates) < 2:
        return ContentDiversityResult(list(range(len(candidates))), "cpu")

    ranked = sorted(
        range(len(candidates)),
        key=lambda index: (-candidates[index].quality, index),
    )
    features = np.stack([candidate.feature for candidate in candidates])
    torch, device = _device(use_gpu)
    retained: list[int] = []
    if torch is not None and device != "cpu":
        tensor = torch.from_numpy(features).to(device)
        for index in ranked:
            if retained:
                similarity = tensor[retained] @ tensor[index]
                if float(similarity.max().item()) >= threshold:
                    continue
            retained.append(index)
        del tensor
        if device == "cuda":
            torch.cuda.empty_cache()
    else:
        for index in ranked:
            if retained and float((features[retained] @ features[index]).max()) >= threshold:
                continue
            retained.append(index)
        device = "cpu"

    retained.sort()
    log.info(
        "Whole-video content diversity: %d candidates -> %d compositions on %s "
        "(threshold=%.3f)",
        len(candidates),
        len(retained),
        device,
        threshold,
    )
    return ContentDiversityResult(retained, device)
