//! App store: config, presets, input/output paths, persisted prefs, run state.
//! Prefs live here (merged into the store) to avoid a one-function module.

import type { ExtractConfig } from "../api/types";
import { listPresets, loadPreset } from "../api/ipc";
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

  async init(): Promise<void> {
    this.presets = await listPresets();
  }

  async applyPreset(name: string): Promise<void> {
    this.presetName = name;
    this.config = await loadPreset(name);
  }

  setInputPath(p: string): void {
    this.inputPath = p;
    this.prefs.input = p;
  }

  setOutputPath(p: string): void {
    this.outputPath = p;
    this.prefs.output = p;
  }

  setLang(lang: "en" | "zh"): void {
    this.lang = lang;
    this.prefs.lang = lang;
  }

  setParam(key: string, value: string | number | boolean): void {
    this.config = { ...this.config, [key]: value };
  }

  selectParam(key: string | null): void {
    this.selectedParam = key;
  }
}
