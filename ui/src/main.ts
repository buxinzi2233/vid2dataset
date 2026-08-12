import "./styles.css";
import { renderApp } from "./app";

const previewPresets = [
  { name: "anima-style", description: "Anima Style LoRA — broad sampling, style coverage. Recommended for MMD style sets." },
  { name: "anima-character", description: "Anima Character LoRA — strict quality, fewer frames, looser dedup." },
  { name: "fast-preview", description: "Fast preview — JPG, 768px, one frame per scene. ~10x faster than default." },
];

const previewConfigs: Record<string, Record<string, unknown>> = {
  "anima-style": {
    resolution: 1024,
    blur_threshold: 50,
    max_per_video: null,
    min_per_video: 0,
    phash_distance: 4,
    ssim_threshold: 0.85,
    color_distance: 0.08,
    frames_per_scene: 6,
    bucket_step: 64,
    auto_quality: true,
    decode_mode: "keyframe",
    detect_watermark: true,
    tagger_model: "wd-eva02-large-tagger-v3",
  },
  "anima-character": {
    resolution: 1024,
    blur_threshold: 130,
    max_per_video: null,
    min_per_video: 0,
    phash_distance: 8,
    ssim_threshold: 0.8,
    color_distance: 0.08,
    frames_per_scene: 4,
    bucket_step: 64,
    auto_quality: true,
    decode_mode: "keyframe",
    detect_watermark: true,
    tagger_model: "wd-eva02-large-tagger-v3",
  },
  "fast-preview": {
    resolution: 768,
    blur_threshold: 60,
    max_per_video: null,
    min_per_video: 0,
    phash_distance: 6,
    ssim_threshold: 0.85,
    color_distance: 0.08,
    frames_per_scene: 1,
    bucket_step: 64,
    auto_quality: false,
    decode_mode: "keyframe",
    detect_watermark: false,
    tagger_model: "wd-eva02-large-tagger-v3",
  },
};

async function enableBrowserPreview(): Promise<void> {
  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (!import.meta.env.DEV || tauriWindow.__TAURI_INTERNALS__) return;
  const { mockIPC } = await import("@tauri-apps/api/mocks");
  mockIPC((command, args) => {
    if (command === "list_presets") return previewPresets;
    if (command === "load_preset") {
      const name = String((args as { args?: { name?: string } })?.args?.name ?? "anima-style");
      return previewConfigs[name] ?? previewConfigs["anima-style"];
    }
    if (command === "config_validate") return { valid: true, errors: [] };
    if (command === "tagger_status") return { available: false, size_mb: 1200 };
    if (command === "check_update") return { available: false };
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten") return null;
    if (command === "browse_folder") return null;
    if (command === "discover_videos") return [];
    throw new Error(`Browser preview does not implement ${command}`);
  });
}

const root = document.getElementById("app");
if (root) {
  void enableBrowserPreview().then(() => renderApp(root));
} else {
  throw new Error("missing #app mount point");
}
