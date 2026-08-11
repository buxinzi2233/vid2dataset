//! Params view: preset select + parameter grid + switches + validation status.

import { renderPanel } from "../components/Panel";
import { renderSwitch } from "../components/Switch";
import { validateConfig } from "../api/ipc";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

const PARAMS: { key: string; label: string }[] = [
  { key: "resolution", label: "Resolution" },
  { key: "blur_threshold", label: "Blur threshold" },
  { key: "max_per_video", label: "Max per video" },
  { key: "min_per_video", label: "Min per video" },
  { key: "phash_distance", label: "Dedup distance" },
  { key: "ssim_threshold", label: "SSIM diversity" },
  { key: "color_distance", label: "Color distance" },
  { key: "frames_per_scene", label: "Frames / scene" },
];

const SWITCHES: { key: string; label: string }[] = [
  { key: "auto_quality", label: "Auto blur threshold" },
  { key: "keyframe", label: "Keyframe mode (fast)" },
  { key: "subject_size_filter", label: "Subject size filter" },
  { key: "detect_watermark", label: "Detect watermarks" },
  { key: "crop_watermark", label: "Crop watermarks" },
  { key: "flatten_output", label: "Flatten output" },
  { key: "gpu_accel", label: "GPU acceleration" },
];

export function renderParamsView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const status = el("div", "validate-status");

  async function runValidate(): Promise<void> {
    try {
      const result = await validateConfig(store.config);
      if (result.valid) {
        status.textContent = "CONFIG — VALID";
        status.className = "validate-status ok";
      } else {
        status.textContent = `CONFIG — INVALID: ${result.errors
          .map((e) => `${e.field} ${e.message}`)
          .join("; ")}`;
        status.className = "validate-status err";
      }
    } catch (e) {
      status.textContent = `CONFIG — error: ${String(e)}`;
      status.className = "validate-status err";
    }
  }

  // Preset selector
  const presetRow = el("div", "preset-row");
  presetRow.append(el("span", "flabel", t("preset")));
  const presetSelect = el("select", "menu");
  for (const p of store.presets) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    presetSelect.append(opt);
  }
  presetSelect.value = store.presetName || (store.presets[0]?.name ?? "");
  presetSelect.addEventListener("change", async () => {
    await store.applyPreset(presetSelect.value);
    renderGrid();
    renderSwitches();
    await runValidate();
  });
  presetRow.append(presetSelect);

  // Parameter grid
  const grid = el("div", "param-grid");

  function renderGrid(): void {
    grid.innerHTML = "";
    PARAMS.forEach((p, i) => {
      const cell = el("div", "param-cell");
      cell.append(el("div", "pcode", `P.${String(i + 1).padStart(2, "0")}`));
      const labelRow = el("div", "plabel");
      labelRow.append(el("span", undefined, p.label));
      const input = el("input");
      input.type = "text";
      input.value = String(store.config[p.key as keyof typeof store.config] ?? "");
      input.addEventListener("input", () => {
        store.setParam(p.key, parseParam(input.value, p.key));
        void runValidate();
      });
      input.addEventListener("focus", () => store.selectParam(p.key));
      cell.append(labelRow, input);
      grid.append(cell);
    });
  }

  function parseParam(raw: string, key: string): string | number {
    if (["resolution", "max_per_video", "min_per_video", "phash_distance", "frames_per_scene"].includes(key)) {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? raw : n;
    }
    if (["blur_threshold", "ssim_threshold", "color_distance"].includes(key)) {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? raw : n;
    }
    return raw;
  }

  // Switches
  const switchGrid = el("div", "switch-grid");

  function renderSwitches(): void {
    switchGrid.innerHTML = "";
    SWITCHES.forEach((s) => {
      switchGrid.append(
        renderSwitch({
          label: s.label,
          checked: Boolean(store.config[s.key as keyof typeof store.config]),
          onChange: (on) => {
            store.setParam(s.key, on);
            void runValidate();
          },
        }),
      );
    });
  }

  renderGrid();
  renderSwitches();
  void runValidate();

  const body = el("div", "");
  body.append(presetRow, grid, switchGrid, status);
  root.append(renderPanel({ code: "02", title: t("parameters"), tag: "BUCKET 1024 // STEP 64", body: [body] }));
  return root;
}
