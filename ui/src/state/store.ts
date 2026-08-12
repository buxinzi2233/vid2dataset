//! App store: config, presets, input/output paths, persisted prefs, run state.
//! Prefs live here (merged into the store) to avoid a one-function module.

import type { ExtractConfig } from "../api/types";
import type { DownloadDone, DownloadProgress, TaggerDone } from "../api/events";
import type { HardwareProfile, RuntimeStatus, TaggerStatus, VideoMeta } from "../api/ipc";
import {
  cancelRun,
  discoverVideos,
  gpuDetect,
  gpuDownload,
  gpuStatus,
  listPresets,
  loadPreset,
  probeVideo,
  runTagger as invokeTagger,
  startRun,
  savePreset as savePresetIpc,
  taggerDownload,
  taggerStatus,
} from "../api/ipc";
import { RunState } from "./runState";

export interface PresetInfo {
  name: string;
  description: string;
  user?: boolean;
}

export interface Prefs {
  lang: "en" | "zh";
  input?: string;
  output?: string;
  preset?: string;
}

export interface VideoEntry {
  path: string;
  name: string;
  meta: VideoMeta | null;
  probeError?: string;
}

export interface Segment {
  start: number;
  end: number;
}

export type ResourceState = "idle" | "checking" | "missing" | "downloading" | "ready" | "running" | "done" | "error";

export interface GpuState {
  status: ResourceState;
  hardware: HardwareProfile | null;
  runtime: RuntimeStatus | null;
  progress: number;
  message: string;
}

export interface TaggerState {
  status: ResourceState;
  model: string;
  info: TaggerStatus | null;
  progress: number;
  message: string;
  result: TaggerDone | null;
  pendingRun: boolean;
}

type Listener = () => void;

export class Store {
  config: Partial<ExtractConfig> = {};
  presets: PresetInfo[] = [];
  inputPath = "";
  outputPath = "";
  lang: "en" | "zh" = "zh";
  prefs: Prefs = { lang: "zh" };
  presetName = "";
  selectedParam: string | null = "resolution";
  inspectorOpen = false;
  videos: VideoEntry[] = [];
  selectedVideo: string | null = null;
  rosterStatus = "";
  rosterLoading = false;
  headTheme: "dark" | "light" = "dark";
  zoom = 1;
  gpu: GpuState = {
    status: "idle",
    hardware: null,
    runtime: null,
    progress: 0,
    message: "",
  };
  tagger: TaggerState = {
    status: "idle",
    model: "wd-eva02-large-tagger-v3",
    info: null,
    progress: 0,
    message: "",
    result: null,
    pendingRun: false,
  };
  segments: Record<string, Segment[]> = {};
  run: RunState;
  private listeners = new Set<Listener>();
  private presetRequest = 0;

  constructor() {
    this.run = new RunState(() => this.notify());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  async init(): Promise<void> {
    this.presets = await listPresets();
    const initial = this.presets.some((preset) => preset.name === "anima-style")
      ? "anima-style"
      : this.presets[0]?.name;
    if (initial) await this.applyPreset(initial);
  }

  async applyPreset(name: string): Promise<void> {
    const request = ++this.presetRequest;
    this.presetName = name;
    this.prefs.preset = name;
    this.notify();
    const config = await loadPreset(name);
    if (request !== this.presetRequest) return;
    this.config = config;
    this.notify();
    if (config.gpu_accel) await this.setGpuEnabled(true);
  }

  async savePreset(name: string, description: string): Promise<string> {
    const saved = await savePresetIpc(name, description, this.presetConfig());
    const listed = await listPresets();
    this.presets = listed.some((preset) => preset.name === saved.name)
      ? listed
      : [...listed, saved].sort((a, b) => a.name.localeCompare(b.name));
    this.presetName = saved.name;
    this.prefs.preset = saved.name;
    this.notify();
    return saved.name;
  }

  presetConfig(): Partial<ExtractConfig> {
    const excluded = new Set(["input", "output", "segments", "dedup_index"]);
    return Object.fromEntries(
      Object.entries(this.config).filter(([key]) => !excluded.has(key)),
    ) as Partial<ExtractConfig>;
  }

  setInputPath(p: string): void {
    if (p !== this.inputPath) {
      this.videos = [];
      this.selectedVideo = null;
      this.rosterStatus = "";
    }
    this.inputPath = p;
    this.prefs.input = p;
    this.notify();
  }

  setOutputPath(p: string): void {
    this.outputPath = p;
    this.prefs.output = p;
    this.notify();
  }

  setLang(lang: "en" | "zh"): void {
    this.lang = lang;
    this.prefs.lang = lang;
    this.notify();
  }

  setParam(key: string, value: string | number | boolean | null): void {
    this.config = { ...this.config, [key]: value };
    this.notify();
  }

  selectParam(key: string | null, openInspector = false): void {
    this.selectedParam = key;
    if (openInspector) this.inspectorOpen = true;
    this.notify();
  }

  setInspectorOpen(open: boolean): void {
    this.inspectorOpen = open;
    this.notify();
  }

  selectVideo(path: string): void {
    this.selectedVideo = path;
    this.notify();
  }

  setHeadTheme(theme: "dark" | "light"): void {
    this.headTheme = theme;
    this.notify();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.notify();
  }

  presetDescription(): string {
    return this.presets.find((preset) => preset.name === this.presetName)?.description ?? "";
  }

  async setGpuEnabled(enabled: boolean): Promise<void> {
    this.setParam("gpu_accel", enabled);
    if (!enabled) {
      this.gpu = { status: "idle", hardware: null, runtime: null, progress: 0, message: "" };
      this.notify();
      return;
    }
    if (this.gpu.status === "checking" || this.gpu.status === "downloading") return;

    this.gpu = { ...this.gpu, status: "checking", progress: 0, message: "" };
    this.notify();
    try {
      const [hardware, runtime] = await Promise.all([gpuDetect(), gpuStatus()]);
      this.gpu = {
        status: runtime.available ? "ready" : runtime.can_download ? "downloading" : "error",
        hardware,
        runtime,
        progress: runtime.available ? 100 : 0,
        message: runtime.error ?? "",
      };
      this.notify();
      if (!runtime.available && runtime.can_download) await gpuDownload();
      else if (!runtime.available) this.setParam("gpu_accel", false);
    } catch (error) {
      this.gpu = { ...this.gpu, status: "error", message: String(error) };
      this.setParam("gpu_accel", false);
      this.notify();
    }
  }

  async inspectTagger(model: string): Promise<void> {
    if (this.tagger.model === model && ["checking", "downloading", "running"].includes(this.tagger.status)) return;
    this.tagger = {
      ...this.tagger,
      status: "checking",
      model,
      info: null,
      progress: 0,
      message: "",
      result: null,
      pendingRun: false,
    };
    this.notify();
    try {
      const info = await taggerStatus(model);
      this.tagger = { ...this.tagger, info, status: info.available ? "ready" : "missing" };
    } catch (error) {
      this.tagger = { ...this.tagger, status: "error", message: String(error) };
    }
    this.notify();
  }

  async startTagger(): Promise<void> {
    if (!this.outputPath) {
      this.tagger = { ...this.tagger, status: "error", message: "no-output" };
      this.notify();
      return;
    }
    if (this.tagger.status === "checking" || this.tagger.status === "downloading" || this.tagger.status === "running") return;
    if (!this.tagger.info?.available) {
      this.tagger = { ...this.tagger, status: "downloading", pendingRun: true, progress: 0, message: "" };
      this.notify();
      try {
        await taggerDownload(this.tagger.model);
      } catch (error) {
        this.tagger = { ...this.tagger, status: "error", pendingRun: false, message: String(error) };
        this.notify();
      }
      return;
    }

    this.tagger = { ...this.tagger, status: "running", progress: 0, message: "", result: null };
    this.notify();
    try {
      await invokeTagger({
        folder: this.outputPath,
        modelName: this.tagger.model,
        triggerWord: String(this.config.trigger_word ?? ""),
        blacklist: String(this.config.tag_blacklist ?? ""),
        require: String(this.config.tag_require ?? ""),
        exclude: String(this.config.tag_exclude ?? ""),
        always: String(this.config.tag_always ?? ""),
        traitPruneThreshold: Number(this.config.trait_prune_threshold ?? 0),
        generalThreshold: Number(this.config.tag_general_threshold ?? 0.35),
        characterThreshold: Number(this.config.tag_character_threshold ?? 0.85),
        useGpu: Boolean(this.config.gpu_accel),
      });
    } catch (error) {
      this.tagger = { ...this.tagger, status: "error", message: String(error) };
      this.notify();
    }
  }

  setTaggerProgress(current: number, total: number): void {
    this.tagger = {
      ...this.tagger,
      status: "running",
      progress: total > 0 ? Math.round((current / total) * 100) : 0,
    };
    this.notify();
  }

  handleDownloadProgress(event: DownloadProgress): void {
    const progress = event.total > 0 ? Math.round((event.current / event.total) * 100) : 0;
    const target = event.pkg.toLowerCase().includes("tag") || this.tagger.status === "downloading" ? "tagger" : "gpu";
    if (target === "tagger") {
      this.tagger = { ...this.tagger, status: "downloading", progress, message: event.pkg };
    } else {
      this.gpu = { ...this.gpu, status: "downloading", progress, message: event.pkg };
    }
    this.notify();
  }

  async handleDownloadDone(event: DownloadDone): Promise<void> {
    if (event.kind === "gpu") {
      if (!event.error) {
        try {
          const runtime = await gpuStatus();
          this.gpu = {
            ...this.gpu,
            runtime,
            status: runtime.available ? "ready" : "error",
            progress: runtime.available ? 100 : this.gpu.progress,
            message: runtime.available ? "" : runtime.error ?? "CUDA runtime activation failed",
          };
          if (!runtime.available) this.setParam("gpu_accel", false);
        } catch (error) {
          this.gpu = { ...this.gpu, status: "error", message: String(error) };
          this.setParam("gpu_accel", false);
        }
        this.notify();
        return;
      }
      this.gpu = {
        ...this.gpu,
        status: "error",
        progress: this.gpu.progress,
        message: event.error,
      };
      this.setParam("gpu_accel", false);
    } else {
      const pendingRun = this.tagger.pendingRun;
      this.tagger = {
        ...this.tagger,
        status: event.error ? "error" : "ready",
        info: event.error ? this.tagger.info : { available: true, size_mb: this.tagger.info?.size_mb ?? 0 },
        progress: event.error ? this.tagger.progress : 100,
        message: event.error ?? "",
        pendingRun: false,
      };
      if (!event.error && pendingRun) void this.startTagger();
    }
    this.notify();
  }

  handleTaggerDone(result: TaggerDone): void {
    this.tagger = {
      ...this.tagger,
      status: result.error ? "error" : result.cancelled ? "idle" : "done",
      progress: result.error ? this.tagger.progress : 100,
      result,
      message: result.error ?? "",
    };
    this.notify();
  }

  async refreshVideos(): Promise<void> {
    if (!this.inputPath) {
      this.videos = [];
      this.rosterStatus = "no-input";
      this.notify();
      return;
    }

    this.rosterLoading = true;
    this.rosterStatus = "loading";
    this.notify();
    try {
      const paths = await discoverVideos(this.inputPath);
      const entries = await Promise.all(paths.map(async (path): Promise<VideoEntry> => {
        const name = path.split(/[\\/]/).pop() ?? path;
        try {
          return { path, name, meta: await probeVideo(path) };
        } catch (error) {
          return { path, name, meta: null, probeError: String(error) };
        }
      }));
      this.videos = entries;
      this.rosterStatus = entries.length ? "ready" : "empty";
      if (this.selectedVideo && !entries.some((entry) => entry.path === this.selectedVideo)) {
        this.selectedVideo = null;
      }
    } catch (error) {
      this.videos = [];
      this.rosterStatus = `error:${String(error)}`;
    } finally {
      this.rosterLoading = false;
      this.notify();
    }
  }

  buildConfig(): Partial<ExtractConfig> & { input: string; output: string } {
    const segments: Record<string, [number, number][]> = {};
    for (const [name, segs] of Object.entries(this.segments)) {
      if (segs.length) segments[name] = segs.map((s) => [s.start, s.end]);
    }
    return {
      input: this.inputPath || "output",
      output: this.outputPath || "output",
      ...this.config,
      segments,
    } as unknown as Partial<ExtractConfig> & { input: string; output: string };
  }

  async start(): Promise<void> {
    if (this.config.gpu_accel) {
      if (this.gpu.status !== "ready" || !this.gpu.runtime?.available) {
        await this.setGpuEnabled(true);
      }
      if (this.gpu.status !== "ready" || !this.gpu.runtime?.available) {
        throw new Error(this.gpu.message || "GPU acceleration was requested, but CUDA is not ready");
      }
    }
    this.run.start();
    await startRun(this.buildConfig() as ExtractConfig);
  }

  async cancel(): Promise<void> {
    this.run.setStatus("cancelling");
    try {
      await cancelRun();
    } catch (error) {
      this.run.setStatus("running");
      throw error;
    }
  }
}
