import { gpuDownload } from "../api/ipc";
import { renderPanel } from "../components/Panel";
import { renderSwitch } from "../components/Switch";
import { renderSelectMenu } from "../components/SelectMenu";
import { el } from "../components/el";
import { t } from "../i18n";
import { PARAMS, SWITCHES, parseParamValue } from "../state/paramMeta";
import type { Store } from "../state/store";
import { validateConfig } from "../api/ipc";

export interface ParamsView {
  root: HTMLElement;
  destroy: () => void;
}

export function renderParamsView(store: Store): ParamsView {
  const root = el("section", "view");
  root.dataset.view = "params";
  const inner = el("div", "inner");
  const body = el("div");
  const presetRow = el("div", "preset-row");
  const presetSelect = renderSelectMenu({
    options: store.presets.map((preset) => ({ value: preset.name, label: preset.name })),
    value: store.presetName,
    className: "preset-select",
    ariaLabel: t("preset"),
    onChange: (value) => void store.applyPreset(value),
  });
  presetSelect.root.dataset.preset = "params";
  const presetDesc = el("span", "preset-desc");
  presetRow.append(el("span", "flabel", t("preset")), presetSelect.root, presetDesc);

  const grid = el("div", "param-grid");
  const inputs = new Map<string, HTMLInputElement>();
  for (const [index, meta] of PARAMS.entries()) {
    const cell = el("div", "param-cell");
    cell.dataset.param = meta.key;
    cell.append(el("div", "pcode", `P.${String(index + 1).padStart(2, "0")}`));
    const label = el("div", "plabel");
    const info = el("button", "pinfo", "?");
    info.type = "button";
    info.title = meta.tip;
    info.addEventListener("click", (event) => {
      event.stopPropagation();
      const same = store.selectedParam === meta.key && store.inspectorOpen;
      store.selectParam(meta.key);
      store.setInspectorOpen(!same);
    });
    label.append(el("span", undefined, meta.label), info);
    const input = el("input");
    input.inputMode = "decimal";
    input.addEventListener("focus", () => store.selectParam(meta.key, true));
    input.addEventListener("input", () => {
      store.setParam(meta.key, parseParamValue(input.value, meta) as string | number);
      void runValidate();
    });
    cell.addEventListener("click", () => store.selectParam(meta.key, true));
    cell.append(label, input);
    grid.append(cell);
    inputs.set(meta.key, input);
  }

  const switchGrid = el("div", "switch-grid");
  const switchControls = new Map<string, HTMLElement>();
  for (const [index, item] of SWITCHES.entries()) {
    const checked = item.key === "decode_mode"
      ? store.config.decode_mode === "keyframe"
      : Boolean(store.config[item.key as keyof typeof store.config]);
    const control = renderSwitch({
      key: item.key,
      label: item.label,
      checked,
      onChange: (on) => {
        store.selectParam(item.key, true);
        if (item.key === "gpu_accel") void store.setGpuEnabled(on);
        else if (item.key === "decode_mode") store.setParam("decode_mode", on ? "keyframe" : "accurate");
        else store.setParam(item.key, on);
        void runValidate();
      },
    });
    control.title = item.tip;
    const info = el("button", "pinfo sinfo", "?");
    info.type = "button";
    info.title = item.tip;
    info.setAttribute("aria-label", `${item.label} ${t("inspect")}`);
    info.addEventListener("click", () => {
      const same = store.selectedParam === item.key && store.inspectorOpen;
      store.selectParam(item.key);
      store.setInspectorOpen(!same);
    });
    const itemWrap = el("div", "switch-item");
    itemWrap.dataset.switchParam = item.key;
    itemWrap.dataset.switchCode = `S.${String(index + 1).padStart(2, "0")}`;
    itemWrap.append(control, info);
    switchControls.set(item.key, itemWrap);
    switchGrid.append(itemWrap);
  }

  const gpuStatus = el("div", "resource-status");
  const validateStatus = el("div", "validate-status");
  let validationSeq = 0;
  async function runValidate(): Promise<void> {
    const seq = ++validationSeq;
    try {
      const result = await validateConfig(store.buildConfig());
      if (seq !== validationSeq) return;
      validateStatus.className = `validate-status ${result.valid ? "ok" : "err"}`;
      validateStatus.textContent = result.valid
        ? "CONFIG — VALID"
        : `CONFIG — INVALID: ${result.errors.map((error) => `${error.field} ${error.message}`).join("; ")}`;
    } catch (error) {
      if (seq !== validationSeq) return;
      validateStatus.className = "validate-status err";
      validateStatus.textContent = `CONFIG — ${String(error)}`;
    }
  }

  function render(): void {
    presetSelect.setValue(store.presetName);
    presetDesc.textContent = store.presetDescription();
    for (const meta of PARAMS) {
      const input = inputs.get(meta.key);
      if (input && document.activeElement !== input) {
        const raw = store.config[meta.key as keyof typeof store.config];
        input.value = raw === null || raw === undefined ? "0" : String(raw);
      }
      input?.closest(".param-cell")?.classList.toggle("selected", store.selectedParam === meta.key);
    }
    for (const item of SWITCHES) {
      const on = item.key === "decode_mode"
        ? store.config.decode_mode === "keyframe"
        : Boolean(store.config[item.key as keyof typeof store.config]);
      const itemWrap = switchControls.get(item.key);
      itemWrap?.classList.toggle("selected", store.selectedParam === item.key);
      const control = itemWrap?.querySelector<HTMLLabelElement>(".sw");
      control?.classList.toggle("on", on);
      const checkbox = itemWrap?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (checkbox) checkbox.checked = on;
    }

    const { gpu } = store;
    gpuStatus.className = `resource-status ${gpu.status === "error" ? "err" : gpu.status === "ready" ? "ok" : ""}`;
    if (gpu.status === "idle") gpuStatus.textContent = "GPU RUNTIME — OFF";
    else if (gpu.status === "checking") gpuStatus.textContent = "GPU RUNTIME — DETECTING";
    else if (gpu.status === "downloading") gpuStatus.textContent = `GPU RUNTIME — DOWNLOADING ${gpu.progress}% ${gpu.message}`;
    else if (gpu.status === "ready") gpuStatus.textContent = `GPU RUNTIME — READY · ${gpu.hardware?.gpu_name || gpu.hardware?.vendor || "GPU"}`;
    else gpuStatus.textContent = `GPU RUNTIME — ERROR · ${gpu.message}`;
  }

  const retryGpu = el("button", "resource-retry", "RETRY GPU DOWNLOAD");
  retryGpu.type = "button";
  retryGpu.addEventListener("click", async () => {
    try {
      await gpuDownload();
    } catch (error) {
      gpuStatus.textContent = String(error);
    }
  });
  gpuStatus.append(retryGpu);
  body.append(presetRow, grid, switchGrid, gpuStatus, validateStatus);
  const tag = `BUCKET ${store.config.resolution ?? 1024} // STEP ${store.config.bucket_step ?? 64}`;
  const panel = renderPanel({ code: "02", title: t("parameters"), tag, body: [body] });
  inner.append(panel);
  root.append(inner);

  const unsubscribe = store.subscribe(() => {
    render();
    const headerTag = panel.querySelector<HTMLElement>(".ptag");
    if (headerTag) headerTag.textContent = `BUCKET ${store.config.resolution ?? 1024} // STEP ${store.config.bucket_step ?? 64}`;
  });
  render();
  void runValidate();
  return { root, destroy: () => {
    unsubscribe();
    presetSelect.destroy();
  } };
}
