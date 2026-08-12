import { describe, expect, it, vi } from "vitest";

import type { ExtractDone } from "../api/events";
import { RunState, aggregateResult, rejectedCount } from "./runState";

const RESULT: ExtractDone = {
  total_written: 7,
  total_candidates: 16,
  elapsed_s: 4.25,
  contact_sheet: null,
  html_gallery: null,
  tagging: null,
  videos: [{
    video: "clip.mp4",
    duration_s: 2,
    fps: 30,
    width: 640,
    height: 360,
    scenes: 2,
    candidates: 16,
    written: 7,
    rejected_blur: 2,
    rejected_luma: 1,
    rejected_too_small: 0,
    rejected_dup: 3,
    rejected_ssim: 2,
    rejected_color: 1,
    rejected_completeness: 0,
    auto_blur_threshold: 48,
    elapsed_s: 4.1,
    watermarks: [{ side: "right" }, { side: "left" }],
  }],
};

describe("RunState", () => {
  it("keeps the full pipeline result on completion", () => {
    const notify = vi.fn();
    const state = new RunState(notify);
    state.start();
    state.finish(RESULT);
    expect(state.status).toBe("done");
    expect(state.progress).toBe(100);
    expect(state.totalWritten).toBe(7);
    expect(state.totalCandidates).toBe(16);
    expect(state.result).toBe(RESULT);
  });

  it("aggregates every rejection reason and watermark", () => {
    expect(rejectedCount(RESULT.videos[0])).toBe(9);
    expect(aggregateResult(RESULT)).toEqual({ written: 7, rejected: 9, watermarks: 2, elapsed: 4.25 });
  });
});
