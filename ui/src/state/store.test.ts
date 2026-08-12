import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc", () => ({
  cancelRun: vi.fn(),
  discoverVideos: vi.fn(),
  gpuDetect: vi.fn(),
  gpuDownload: vi.fn(),
  gpuStatus: vi.fn(),
  listPresets: vi.fn(async () => [
    { name: "fast-preview", description: "Fast" },
    { name: "anima-style", description: "Style" },
  ]),
  loadPreset: vi.fn(async (name: string) => name === "anima-style"
    ? { resolution: 1024, bucket_step: 64, max_per_video: null }
    : { resolution: 768, bucket_step: 64, max_per_video: 10 }),
  probeVideo: vi.fn(),
  runTagger: vi.fn(),
  startRun: vi.fn(),
  taggerDownload: vi.fn(),
  taggerStatus: vi.fn(),
}));

import { Store } from "./store";
import { loadPreset } from "../api/ipc";

describe("Store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("selects anima-style during initialization", async () => {
    const store = new Store();
    await store.init();
    expect(store.presetName).toBe("anima-style");
    expect(store.presetDescription()).toBe("Style");
    expect(store.config.resolution).toBe(1024);
  });

  it("serializes segments into the extraction config", () => {
    const store = new Store();
    store.setInputPath("/videos");
    store.setOutputPath("/dataset");
    store.segments["clip.mp4"] = [{ start: 1.25, end: 3.5 }];
    const config = store.buildConfig();
    expect(config.input).toBe("/videos");
    expect(config.output).toBe("/dataset");
    expect(config.segments).toEqual({ "clip.mp4": [[1.25, 3.5]] });
  });

  it("synchronizes the preset name immediately and ignores stale responses", async () => {
    const pending = new Map<string, (value: { resolution: number }) => void>();
    vi.mocked(loadPreset).mockImplementation((name: string) => new Promise((resolve) => pending.set(name, resolve)) as never);
    const store = new Store();
    const snapshots: string[] = [];
    store.subscribe(() => snapshots.push(store.presetName));

    const first = store.applyPreset("anima-style");
    expect(store.presetName).toBe("anima-style");
    expect(snapshots.at(-1)).toBe("anima-style");
    const second = store.applyPreset("fast-preview");
    expect(store.presetName).toBe("fast-preview");

    pending.get("fast-preview")?.({ resolution: 768 });
    await second;
    pending.get("anima-style")?.({ resolution: 1024 });
    await first;

    expect(store.presetName).toBe("fast-preview");
    expect(store.config.resolution).toBe(768);
  });
});
