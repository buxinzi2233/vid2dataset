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

export interface ExtractDone {
  total_written: number;
  total_candidates: number;
  elapsed_s: number;
  contact_sheet: string | null;
  html_gallery: string | null;
  tagging: unknown;
  videos: unknown[];
}

export interface ExtractError {
  message: string;
}

export interface DownloadProgress {
  pkg: string;
  current: number;
  total: number;
}

type Unlisten = () => void;

export async function onExtractProgress(fn: (e: ExtractProgress) => void): Promise<Unlisten> {
  return listen<ExtractProgress>("extract.progress", (e) => fn(e.payload));
}

export async function onExtractLog(fn: (e: ExtractLog) => void): Promise<Unlisten> {
  return listen<ExtractLog>("extract.log", (e) => fn(e.payload));
}

export async function onExtractDone(fn: (e: ExtractDone) => void): Promise<Unlisten> {
  return listen<ExtractDone>("extract.done", (e) => fn(e.payload));
}

export async function onExtractError(fn: (e: ExtractError) => void): Promise<Unlisten> {
  return listen<ExtractError>("extract.error", (e) => fn(e.payload));
}

export async function onDownloadProgress(fn: (e: DownloadProgress) => void): Promise<Unlisten> {
  return listen<DownloadProgress>("download.progress", (e) => fn(e.payload));
}
