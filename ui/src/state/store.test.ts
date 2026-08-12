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
  savePreset: vi.fn(async (name: string, description: string) => ({ name, description, user: true, path: `/tmp/${name}.toml` })),
  startRun: vi.fn(),
  taggerDownload: vi.fn(),
  taggerStatus: vi.fn(),
}));

import { Store } from "./store";
import { loadPreset } from "../api/ipc";
import { gpuDownload, gpuStatus, listPresets, savePreset, startRun } from "../api/ipc";

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

  it("saves current parameters without transient paths or segments", async () => {
    vi.mocked(listPresets).mockResolvedValueOnce([]);
    const store = new Store();
    store.config = {
      resolution: 768,
      gpu_accel: true,
      input: "/videos",
      output: "/dataset",
      segments: "ignored" as never,
    };

    await store.savePreset("my-v100", "GPU");

    expect(savePreset).toHaveBeenCalledWith("my-v100", "GPU", {
      resolution: 768,
      gpu_accel: true,
    });
    expect(store.presetName).toBe("my-v100");
    expect(store.presets).toEqual([
      { name: "my-v100", description: "GPU", user: true, path: "/tmp/my-v100.toml" },
    ]);
  });

  it("does not download when the current CUDA runtime is already available", async () => {
    vi.mocked(gpuStatus).mockResolvedValue({
      available: true,
      cached: false,
      version: null,
      cache_dir: "/venv",
      size_mb: 0,
      cuda_tag: "cu126",
      can_download: false,
    });
    const { gpuDetect } = await import("../api/ipc");
    vi.mocked(gpuDetect).mockResolvedValue({
      vendor: "NVIDIA", gpu_name: "Tesla V100", arch: "", compute_cap: 7.0,
      os_name: "linux", os_arch: "x86_64",
    });
    const store = new Store();

    await store.setGpuEnabled(true);

    expect(store.gpu.status).toBe("ready");
    expect(store.config.gpu_accel).toBe(true);
    expect(gpuDownload).not.toHaveBeenCalled();
  });

  it("rechecks CUDA after download and disables the switch on activation failure", async () => {
    vi.mocked(gpuStatus).mockResolvedValue({
      available: false,
      cached: true,
      version: "broken",
      cache_dir: "/cache",
      size_mb: 800,
      cuda_tag: "cu126",
      error: "CUDA activation failed",
      can_download: true,
    });
    const store = new Store();
    store.config.gpu_accel = true;

    await store.handleDownloadDone({ kind: "gpu" });

    expect(store.gpu.status).toBe("error");
    expect(store.config.gpu_accel).toBe(false);
  });

  it("does not start extraction when GPU was requested but CUDA is unavailable", async () => {
    vi.mocked(gpuStatus).mockResolvedValue({
      available: false,
      cached: false,
      version: null,
      cache_dir: "/cache",
      size_mb: 0,
      cuda_tag: null,
      error: "CUDA is unavailable",
      can_download: false,
    });
    const store = new Store();
    store.config.gpu_accel = true;

    await expect(store.start()).rejects.toThrow("CUDA is unavailable");

    expect(store.run.status).toBe("idle");
    expect(startRun).not.toHaveBeenCalled();
  });
});
