//! Typed Tauri event subscriptions. Event names match `docs/api-contract.md` §4.

import { listen } from "@tauri-apps/api/event";

export interface ExtractProgress {
  stage: string;
  current: number;
  total: number;
}

export interface ExtractLog {
  line: string;
}

export interface WatermarkSummary {
  [key: string]: unknown;
}

export interface VideoStatsSummary {
  video: string;
  duration_s: number;
  fps: number;
  width: number;
  height: number;
  scenes: number;
  candidates: number;
  written: number;
  rejected_blur: number;
  rejected_luma: number;
  rejected_too_small: number;
  rejected_dup: number;
  rejected_ssim: number;
  rejected_color: number;
  rejected_completeness: number;
  auto_blur_threshold: number | null;
  elapsed_s: number;
  watermarks: WatermarkSummary[];
}

export interface TaggerDone {
  tagged: number;
  failed: number;
  total: number;
  cancelled: boolean;
  rejected: string[];
  pruned_tags: string[];
  tag_counts: Record<string, number>;
  per_image: Record<string, unknown>;
  error?: string;
}

export interface ExtractDone {
  total_written: number;
  total_candidates: number;
  elapsed_s: number;
  contact_sheet: string | null;
  html_gallery: string | null;
  tagging: TaggerDone | null;
  videos: VideoStatsSummary[];
}

export interface ExtractError {
  message: string;
}

export interface DownloadProgress {
  pkg: string;
  current: number;
  total: number;
}

export interface DownloadDone {
  kind: "gpu" | "tagger";
  error?: string;
}

type Unlisten = () => void;

export async function onExtractProgress(fn: (e: ExtractProgress) => void): Promise<Unlisten> {
  return listen<ExtractProgress>("extract:progress", (e) => fn(e.payload));
}

export async function onExtractLog(fn: (e: ExtractLog) => void): Promise<Unlisten> {
  return listen<ExtractLog>("extract:log", (e) => fn(e.payload));
}

export async function onExtractDone(fn: (e: ExtractDone) => void): Promise<Unlisten> {
  return listen<ExtractDone>("extract:done", (e) => fn(e.payload));
}

export async function onExtractError(fn: (e: ExtractError) => void): Promise<Unlisten> {
  return listen<ExtractError>("extract:error", (e) => fn(e.payload));
}

export async function onDownloadProgress(fn: (e: DownloadProgress) => void): Promise<Unlisten> {
  return listen<DownloadProgress>("download:progress", (e) => fn(e.payload));
}

export async function onDownloadDone(fn: (e: DownloadDone) => void): Promise<Unlisten> {
  return listen<DownloadDone>("download:done", (e) => fn(e.payload));
}

export async function onTaggerDone(fn: (e: TaggerDone) => void): Promise<Unlisten> {
  return listen<TaggerDone>("tagger:done", (e) => fn(e.payload));
}
