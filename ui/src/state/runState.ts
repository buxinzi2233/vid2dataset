//! Extraction run state machine.

import type { ExtractDone, VideoStatsSummary } from "../api/events";

export type RunStatus = "idle" | "running" | "cancelling" | "done" | "error";

export class RunState {
  status: RunStatus = "idle";
  progress = 0;
  log: string[] = [];
  stage = "";
  current = 0;
  total = 0;
  totalWritten = 0;
  totalCandidates = 0;
  elapsedSeconds = 0;
  errorMessage = "";
  result: ExtractDone | null = null;
  private readonly notify: () => void;

  constructor(notify: () => void) {
    this.notify = notify;
  }

  setStatus(s: RunStatus): void {
    this.status = s;
    this.notify();
  }

  setProgress(n: number, stage: string, current: number, total: number): void {
    this.progress = n;
    this.stage = stage;
    this.current = current;
    this.total = total;
    this.notify();
  }

  appendLog(line: string): void {
    this.log.push(line);
    this.notify();
  }

  start(): void {
    this.reset();
    this.status = "running";
    this.notify();
  }

  finish(result: ExtractDone): void {
    this.progress = 100;
    this.totalWritten = result.total_written;
    this.totalCandidates = result.total_candidates;
    this.elapsedSeconds = result.elapsed_s;
    this.result = result;
    this.status = "done";
    this.notify();
  }

  fail(message: string): void {
    this.errorMessage = message;
    this.status = "error";
    this.notify();
  }

  reset(): void {
    this.progress = 0;
    this.log = [];
    this.stage = "";
    this.current = 0;
    this.total = 0;
    this.totalWritten = 0;
    this.totalCandidates = 0;
    this.elapsedSeconds = 0;
    this.errorMessage = "";
    this.result = null;
    this.status = "idle";
  }
}

const REJECTION_KEYS: (keyof VideoStatsSummary)[] = [
  "rejected_blur",
  "rejected_luma",
  "rejected_too_small",
  "rejected_dup",
  "rejected_ssim",
  "rejected_color",
  "rejected_completeness",
  "rejected_content",
  "rejected_temporal",
];

export function rejectedCount(video: VideoStatsSummary): number {
  return REJECTION_KEYS.reduce((sum, key) => sum + Number(video[key] ?? 0), 0);
}

export function aggregateResult(result: ExtractDone | null): {
  written: number;
  rejected: number;
  watermarks: number;
  elapsed: number;
} {
  if (!result) return { written: 0, rejected: 0, watermarks: 0, elapsed: 0 };
  return {
    written: result.total_written,
    rejected: result.videos.reduce((sum, video) => sum + rejectedCount(video), 0),
    watermarks: result.videos.reduce((sum, video) => sum + video.watermarks.length, 0),
    elapsed: result.elapsed_s,
  };
}
