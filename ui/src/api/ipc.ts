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
