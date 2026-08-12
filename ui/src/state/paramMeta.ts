export interface ParamMeta {
  key: string;
  label: string;
  unit?: string;
  integer?: boolean;
  tip: string;
}

export const PARAMS: ParamMeta[] = [
  { key: "resolution", label: "Resolution", unit: "px", integer: true, tip: "Long edge in pixels. Anima default: 1024. / 长边像素。Anima 默认 1024。" },
  { key: "blur_threshold", label: "Blur threshold", tip: "Minimum Laplacian variance. MMD footage commonly uses 50-100. / 最低拉普拉斯方差，MMD 常用 50-100。" },
  { key: "max_per_video", label: "Max per video", integer: true, tip: "Blank or 0 means no hard limit. / 留空或 0 表示不限制。" },
  { key: "min_per_video", label: "Min per video", integer: true, tip: "Guarantee at least N frames per video. / 保证每个视频至少输出 N 张。" },
  { key: "phash_distance", label: "Dedup distance", integer: true, tip: "0 = identical, 5 = similar, 10+ = loose. / 0 完全相同，5 相似，10 以上较宽松。" },
  { key: "ssim_threshold", label: "SSIM diversity", tip: "Lower values require more diverse poses. / 越低越要求姿态差异。" },
  { key: "color_distance", label: "Color distance", tip: "Higher values require more lighting variety. / 越高越要求光照变化。" },
  { key: "frames_per_scene", label: "Frames / scene", integer: true, tip: "Candidate frames sampled per detected scene. / 每个场景采样的候选帧数。" },
];

export interface SwitchMeta {
  key: string;
  label: string;
  tip: string;
}

export const SWITCHES: SwitchMeta[] = [
  {
    key: "auto_quality",
    label: "Auto blur threshold",
    tip: "Samples frames from each video and derives its blur threshold automatically, overriding the manual value. / 从每个视频采样帧并自动计算模糊阈值，启用时覆盖手动值。",
  },
  {
    key: "decode_mode",
    label: "Keyframe mode (fast)",
    tip: "Seeks to nearby I-frames instead of exact frames. Usually 10-20x faster on 60 fps video, but less precise. / 跳转到邻近 I 帧而非精确帧；60fps 视频通常快 10-20 倍，但定位精度较低。",
  },
  {
    key: "subject_size_filter",
    label: "Subject size filter",
    tip: "Rejects distant shots where the foreground subject occupies too little of the frame. Auto-relaxes if every candidate is rejected. / 拒绝主体占画面过小的远景；若候选帧全部被拒绝会自动放宽。",
  },
  {
    key: "detect_watermark",
    label: "Detect watermarks",
    tip: "Scans static text and logo overlays. Findings are logged and counted only; output images are not modified. / 扫描静态文字和标志覆盖；仅记录并统计，不修改输出图片。",
  },
  {
    key: "crop_watermark",
    label: "Crop watermarks",
    tip: "Expands the bucket crop to remove detected peripheral watermarks. Requires detection; center watermarks are never cropped. / 扩展 bucket 裁切以移除检测到的边缘浮水印；依赖浮水印检测，中央浮水印不会裁切。",
  },
  {
    key: "flatten_output",
    label: "Flatten output",
    tip: "Writes all images directly into the output folder with globally unique names instead of per-video subfolders. / 所有图片直接写入输出目录并使用全局唯一文件名，不再按视频建立子目录。",
  },
  {
    key: "gpu_accel",
    label: "GPU acceleration",
    tip: "Uses the detected GPU runtime for experimental hardware video decoding. Missing runtime is downloaded once; incompatible output falls back safely. / 使用检测到的 GPU 运行时进行实验性硬件解码；缺失组件仅下载一次，不兼容时安全回退。",
  },
];

export function parseParamValue(raw: string, meta: ParamMeta): string | number | null {
  if (meta.key === "max_per_video" && (raw.trim() === "" || raw.trim() === "0")) return null;
  const value = meta.integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  return Number.isNaN(value) ? raw : value;
}
