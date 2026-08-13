export interface ParamMeta {
  key: string;
  label: string;
  unit?: string;
  integer?: boolean;
  tip: string;
}

export const BUCKET_PARAMS: ParamMeta[] = [
  { key: "resolution", label: "Resolution", unit: "px", integer: true, tip: "Long edge in pixels. Anima default: 1024. / 长边像素。Anima 默认 1024。" },
  { key: "blur_threshold", label: "Blur threshold", tip: "Minimum Laplacian variance. MMD footage commonly uses 50-100. / 最低拉普拉斯方差，MMD 常用 50-100。" },
  { key: "max_per_video", label: "Max per video", integer: true, tip: "Blank or 0 means no hard limit. / 留空或 0 表示不限制。" },
  { key: "min_per_video", label: "Min per video", integer: true, tip: "Guarantee at least N frames per video. / 保证每个视频至少输出 N 张。" },
  { key: "phash_distance", label: "Dedup distance", integer: true, tip: "0 = identical, 5 = similar, 10+ = loose. / 0 完全相同，5 相似，10 以上较宽松。" },
  { key: "ssim_threshold", label: "SSIM diversity", tip: "Lower values require more diverse poses. / 越低越要求姿态差异。" },
  { key: "color_distance", label: "Color distance", tip: "Higher values require more lighting variety. / 越高越要求光照变化。" },
  { key: "frames_per_scene", label: "Frames / scene", integer: true, tip: "Candidate frames sampled per detected scene. / 每个场景采样的候选帧数。" },
];

export const STRONG_PARAMS: ParamMeta[] = [
  { key: "dedup_proxy_edge", label: "Proxy edge", unit: "px", integer: true, tip: "CUDA scales content candidates to this long edge for analysis; final PNG files stay at source resolution. / CUDA 将内容候选缩到此长边用于分析；最终 PNG 保持源分辨率。" },
  { key: "native_scan_interval_seconds", label: "Scan interval", unit: "s", tip: "Every source frame is decoded. This is the longest interval between regular candidates; scene changes are emitted immediately. / 每个源帧都会解码；此值是常规候选的最大间隔，转场会立即产生候选。" },
  { key: "native_scene_threshold", label: "Scene sensitivity", tip: "Lower values capture subtler and shorter cuts while increasing proxy candidates. / 越低越容易捕获细微、短暂的镜头变化，同时会增加代理候选。" },
  { key: "blur_threshold", label: "Blur floor", tip: "Absolute sharpness floor. Unique usable content above this value is not removed by a relative whole-video quota. / 绝对清晰度底线；超过此值的独特有效内容不会被整部视频的相对配额删除。" },
  { key: "dedup_phash_distance", label: "pHash distance", integer: true, tip: "Near-exact duplicate recall. 4 is strict and preserves small pose changes. / 近乎完全相同画面的召回阈值；4 较严格，可保留小幅姿态变化。" },
  { key: "dedup_content_threshold", label: "Content diversity", tip: "Similar compositions compete across the whole video, regardless of time. Lower is stronger; 0 disables this stage. / 相似构图无论相隔多久都会竞争；越低越强，0 表示关闭此阶段。" },
  { key: "dedup_temporal_feature_threshold", label: "Motion similarity", tip: "Nearby frames above this feature similarity compete; 0.20 aggressively removes incremental motion while preserving strongly different cuts. / 邻近帧高于此相似度才会竞争；0.20 强力移除渐进微动，同时保留差异显著的镜头。" },
  { key: "dedup_min_seconds", label: "Temporal radius", unit: "s", tip: "Time radius for similar-frame competition. Distinct content inside this radius is still kept. / 相似帧参与竞争的时间半径；半径内视觉内容不同的帧仍会保留。" },
];

export const PARAMS = BUCKET_PARAMS;

export interface SwitchMeta {
  key: string;
  label: string;
  tip: string;
}

export const SWITCHES: SwitchMeta[] = [
  {
    key: "auto_quality",
    label: "Auto blur threshold",
    tip: "Optional relative quality trimming. Keep this off for maximum usable-content coverage; the absolute blur floor still applies. / 可选的相对质量裁剪；追求最大有效内容覆盖时保持关闭，绝对清晰度底线仍生效。",
  },
  {
    key: "decode_mode",
    label: "Keyframe mode (fast)",
    tip: "Used by bucket presets. Native two-stage mode always scans the complete decoded frame stream. / 用于 bucket 预设；原生两阶段模式始终扫描完整解码帧流。",
  },
  {
    key: "subject_size_filter",
    label: "Subject size filter",
    tip: "Rejects distant shots where the foreground subject occupies too little of the frame. / 拒绝主体占画面过小的远景。",
  },
  {
    key: "detect_watermark",
    label: "Detect watermarks",
    tip: "Scans static text and logo overlays. Native output itself is never cropped. / 扫描静态文字和标志覆盖；原生输出本身不会被裁切。",
  },
  {
    key: "crop_watermark",
    label: "Crop watermarks",
    tip: "Applies only to bucket output. Native lossless output never crops source pixels. / 仅用于 bucket 输出；原生无损输出绝不裁切源像素。",
  },
  {
    key: "flatten_output",
    label: "Flatten output",
    tip: "Writes all images directly into the output folder instead of per-video subfolders. / 所有图片直接写入输出目录，不再按视频建立子目录。",
  },
  {
    key: "gpu_accel",
    label: "GPU acceleration",
    tip: "Uses validated NVDEC and CUDA proxy scaling. Strong similarity batches use CUDA when PyTorch CUDA is available. / 使用经验证的 NVDEC 与 CUDA 代理缩放；PyTorch CUDA 可用时强相似度批处理也走 CUDA。",
  },
  {
    key: "output_mode",
    label: "Native lossless output",
    tip: "Filters CUDA proxy frames first, then decodes only winners at the exact source resolution. Use PNG to avoid another lossy encode. / 先筛选 CUDA 代理帧，再仅以源分辨率解码胜出帧；搭配 PNG 避免再次有损编码。",
  },
  {
    key: "dedup_mode",
    label: "Strong content dedup",
    tip: "Combines pHash, spatial feature similarity and SSIM within each video, keeping its full-timeline coverage intact. / 在每个视频内部组合 pHash、空间特征相似度与 SSIM，同时保持该视频完整时间轴覆盖。",
  },
];

export function paramsForConfig(config: Record<string, unknown>): ParamMeta[] {
  return config.output_mode === "native" || config.dedup_mode === "strong"
    ? STRONG_PARAMS
    : BUCKET_PARAMS;
}

export function parseParamValue(raw: string, meta: ParamMeta): string | number | null {
  if (meta.key === "max_per_video" && (raw.trim() === "" || raw.trim() === "0")) return null;
  const value = meta.integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  return Number.isNaN(value) ? raw : value;
}
