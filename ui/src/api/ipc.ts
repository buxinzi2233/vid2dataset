//! Typed Tauri invoke wrappers — the single entry point to Rust commands.
//! Command surface mirrors `docs/api-contract.md` §3.

import { invoke } from "@tauri-apps/api/core";
import type { ExtractConfig } from "./types";

export interface PresetInfo {
  name: string;
  description: string;
}

export function getVersion(): Promise<string> {
  return invoke("get_version");
}

export function getLang(): Promise<string> {
  return invoke("get_lang");
}

export function setLang(lang: string): Promise<void> {
  return invoke("set_lang", { lang });
}

export function listPresets(): Promise<PresetInfo[]> {
  return invoke("list_presets");
}

export function loadPreset(name: string): Promise<Partial<ExtractConfig>> {
  return invoke("load_preset", { name });
}

export function configDefaults(): Promise<Record<string, unknown>> {
  return invoke("config_defaults");
}

export interface ConfigError {
  field: string;
  message: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: ConfigError[];
}

export function validateConfig(config: Partial<ExtractConfig>): Promise<ValidateResult> {
  return invoke("config_validate", { config });
}

export function discoverVideos(path: string): Promise<string[]> {
  return invoke("discover_videos", { path });
}

export function startRun(config: ExtractConfig): Promise<void> {
  return invoke("start_run", { config });
}

export function cancelRun(): Promise<void> {
  return invoke("cancel_run");
}

export function checkUpdate(): Promise<unknown> {
  return invoke("check_update");
}

export interface UpdateInfo {
  available: boolean;
  tag?: string;
  version?: string;
  name?: string;
  notes?: string;
  exe_url?: string | null;
  exe_size?: number;
}

export function checkUpdateInfo(): Promise<UpdateInfo> {
  return invoke("check_update");
}

export function installUpdate(): Promise<{ installed: boolean; reason?: string }> {
  return invoke("install_update");
}

export function gpuDownload(): Promise<{ started: boolean }> {
  return invoke("gpu_download");
}

export function advOpen(path: string): Promise<VideoMeta> {
  return invoke("adv_open", { path });
}

export function advSeek(path: string, frame: number): Promise<{ frame_b64: string }> {
  return invoke("adv_seek", { path, frame });
}

export function advCapture(path: string, frame: number, config: ExtractConfig): Promise<{ out_path: string }> {
  return invoke("adv_capture", { path, frame, config });
}

export function advSegments(segments: Record<string, [number, number][]>): Promise<{ saved: boolean }> {
  return invoke("adv_segments", { segments });
}

export interface VideoMeta {
  path: string;
  fps: number;
  frame_count: number;
  width: number;
  height: number;
  duration_s: number;
}

export interface HardwareProfile {
  vendor: string;
  gpu_name: string;
  arch: string;
  compute_cap: number;
  os_name: string;
  os_arch: string;
}

export interface RuntimeStatus {
  available: boolean;
  cached: boolean;
  version: string | null;
  cache_dir: string;
  size_mb: number;
  cuda_tag: string | null;
}

export function gpuDetect(): Promise<HardwareProfile> {
  return invoke("gpu_detect");
}

export function gpuStatus(): Promise<RuntimeStatus> {
  return invoke("gpu_status");
}

export interface TaggerRunArgs {
  folder: string;
  modelName?: string;
  triggerWord?: string;
  blacklist?: string;
  require?: string;
  exclude?: string;
  always?: string;
  traitPruneThreshold?: number;
  generalThreshold?: number;
  characterThreshold?: number;
  useGpu?: boolean;
}

export function runTagger(args: TaggerRunArgs): Promise<{ started: boolean }> {
  return invoke("tagger_run", { ...args });
}
