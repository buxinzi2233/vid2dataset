//! App store: config, presets, input/output paths, persisted prefs, run state.
//! Prefs live here (merged into the store) to avoid a one-function module.

import type { ExtractConfig } from "../api/types";
import { cancelRun, listPresets, loadPreset, startRun } from "../api/ipc";
import { RunState } from "./runState";

export interface PresetInfo {
  name: string;
  description: string;
}

export interface Prefs {
  lang: "en" | "zh";
  input?: string;
  output?: string;
  preset?: string;
}

export interface Segment {
  start: number;
  end: number;
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
  selectedParam: string | null = null;
  segments: Record<string, Segment[]> = {};
  run = new RunState();
  private listeners: Listener[] = [];

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<void> {
    this.presets = await listPresets();
  }

  async applyPreset(name: string): Promise<void> {
    this.presetName = name;
    this.config = await loadPreset(name);
    this.notify();
  }

  setInputPath(p: string): void {
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
  }

  setParam(key: string, value: string | number | boolean): void {
    this.config = { ...this.config, [key]: value };
    this.notify();
  }

  selectParam(key: string | null): void {
    this.selectedParam = key;
    this.notify();
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
    this.run.setStatus("running");
    await startRun(this.buildConfig() as ExtractConfig);
  }

  async cancel(): Promise<void> {
    this.run.setStatus("cancelling");
    await cancelRun();
  }
}
