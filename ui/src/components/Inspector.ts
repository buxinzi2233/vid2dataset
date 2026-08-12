//! Inspector: right param-parsing column (collapsed tab + expanded panel).
//! Shows the selected parameter's value/description and a live config summary.

import { append, el } from "./el";
import type { Store } from "../state/store";

const PARAM_META: { key: string; label: string; unit?: string }[] = [
  { key: "resolution", label: "Resolution", unit: "px" },
  { key: "blur_threshold", label: "Blur threshold" },
  { key: "max_per_video", label: "Max per video" },
  { key: "min_per_video", label: "Min per video" },
  { key: "phash_distance", label: "Dedup distance" },
  { key: "ssim_threshold", label: "SSIM diversity" },
  { key: "color_distance", label: "Color distance" },
  { key: "frames_per_scene", label: "Frames / scene" },
];

const PARAM_TIPS: Record<string, string> = {
  resolution: "Long edge in pixels. Anima default: 1024.",
  blur_threshold: "Min Laplacian variance. Below = blurry. MMD: 50-100.",
  max_per_video: "0 = no limit.",
  min_per_video: "Guarantee at least N frames per video.",
  phash_distance: "0 = identical, 5 = similar, 10+ = loose.",
  ssim_threshold: "Lower = more diverse poses required.",
  color_distance: "Higher = more lighting variety.",
  frames_per_scene: "Candidate frames sampled per scene.",
};

export interface InspectorProps {
  store: Store;
}

export function renderInspector(props: InspectorProps): HTMLElement {
  const { store } = props;
  const inspector = el("aside", "inspector");

  const tab = el("div", "insp-tab", "INSPECT");
  tab.addEventListener("click", () => {
    inspector.classList.toggle("open");
    if (inspector.classList.contains("open")) render();
  });

  const panel = el("div", "insp-panel");
  const bar = el("div", "ibar");
  bar.append(el("span", undefined, "INSPECT"), el("span", "tag", "RL-PARSE"));

  const codeEl = el("div", "i-code", "P.—");
  const titleEl = el("div", "i-title", "—");
  const valueEl = el("div", "i-value", "—");
  const descEl = el("div", "i-desc", "Select a parameter to inspect.");
  const secEl = el("div", "i-sec", "CONFIG SUMMARY");
  const summaryEl = el("div", "i-summary");

  const body = el("div", "ibody");
  append(body, codeEl, titleEl, valueEl, descEl, secEl, summaryEl);
  append(panel, bar, body);
  append(inspector, tab, panel);

  function render(): void {
    const selected = store.selectedParam;
    const meta = PARAM_META.find((m) => m.key === selected);
    if (!meta) {
      codeEl.textContent = "P.—";
      titleEl.textContent = "—";
      valueEl.textContent = "—";
      descEl.textContent = "Select a parameter to inspect.";
    } else {
      const idx = PARAM_META.findIndex((m) => m.key === meta.key);
      codeEl.textContent = `P.${String(idx + 1).padStart(2, "0")}`;
      titleEl.textContent = meta.label;
      const raw = store.config[meta.key as keyof typeof store.config];
      valueEl.textContent = raw === undefined || raw === "" ? "—" : `${raw}${meta.unit ? ` ${meta.unit}` : ""}`;
      descEl.textContent = PARAM_TIPS[meta.key] ?? "";
    }

    summaryEl.innerHTML = "";
    PARAM_META.forEach((m, i) => {
      const row = el("div", "i-row" + (m.key === selected ? " selected" : ""));
      const top = el("div", "row-top");
      top.append(el("span", "rkey", `P.${String(i + 1).padStart(2, "0")}`));
      top.append(el("span", "rname", m.label));
      const raw = store.config[m.key as keyof typeof store.config];
      const val = raw === undefined || raw === "" ? "—" : `${raw}${m.unit ? ` ${m.unit}` : ""}`;
      const valEl = el("div", "row-val");
      valEl.append(el("span", "rval", val));
      row.append(top, valEl);
      row.addEventListener("click", () => {
        store.selectParam(m.key);
        render();
      });
      summaryEl.append(row);
    });
  }

  // Re-render whenever selection or config changes.
  store.subscribe(render);

  void render();
  return inspector;
}
