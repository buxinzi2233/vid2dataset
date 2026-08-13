import { renderPanel } from "../components/Panel";
import { renderButton } from "../components/Button";
import { renderModal, showModal } from "../components/Modal";
import { renderSwitch } from "../components/Switch";
import { renderSelectMenu } from "../components/SelectMenu";
import { el } from "../components/el";
import { t } from "../i18n";
import { SWITCHES, paramsForConfig, parseParamValue } from "../state/paramMeta";
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
    options: store.presets.map((preset) => ({ value: preset.name, label: preset.user ? `${preset.name} *` : preset.name })),
    value: store.presetName,
    className: "preset-select",
    ariaLabel: t("preset"),
    onChange: (value) => void store.applyPreset(value),
  });
  presetSelect.root.dataset.preset = "params";
  const presetDesc = el("span", "preset-desc");
  const savePresetButton = renderButton({ label: t("save_preset"), className: "preset-save" });
  const presetName = el("input");
  presetName.placeholder = t("preset_name");
  presetName.maxLength = 64;
  const presetDescription = el("input");
  presetDescription.placeholder = t("preset_description");
  presetDescription.maxLength = 160;
  const presetStatus = el("div", "preset-save-status");
  const presetActions = el("div", "modal-actions");
  const presetModal = renderModal({
    title: t("save_preset_title"),
    tag: "USER CONFIG",
    width: 420,
    body: [
      el("label", "preset-save-label", t("preset_name")),
      presetName,
      el("label", "preset-save-label", t("preset_description")),
      presetDescription,
      presetStatus,
      presetActions,
    ],
  });
  const confirmSave = renderButton({ label: t("save"), variant: "fill" });
  confirmSave.addEventListener("click", async () => {
    if (!presetName.value.trim()) {
      presetStatus.textContent = t("preset_name_required");
      presetStatus.className = "preset-save-status err";
      return;
    }
    confirmSave.disabled = true;
    presetStatus.textContent = t("saving");
    presetStatus.className = "preset-save-status";
    try {
      const saved = await store.savePreset(presetName.value, presetDescription.value);
      presetStatus.textContent = t("preset_saved", { name: saved });
      presetStatus.className = "preset-save-status ok";
      presetSelect.setOptions(store.presets.map((preset) => ({ value: preset.name, label: preset.user ? `${preset.name} *` : preset.name })));
      window.setTimeout(() => showModal(presetModal, false), 500);
    } catch (error) {
      presetStatus.textContent = String(error);
      presetStatus.className = "preset-save-status err";
    } finally {
      confirmSave.disabled = false;
    }
  });
  presetActions.append(confirmSave);
  savePresetButton.addEventListener("click", () => {
    presetName.value = store.presetName.startsWith("anima-") || store.presetName === "fast-preview" ? "" : store.presetName;
    presetDescription.value = store.presetDescription();
    presetStatus.textContent = t("preset_save_hint");
    presetStatus.className = "preset-save-status";
    showModal(presetModal, true);
    presetName.focus();
  });
  presetRow.append(el("span", "flabel", t("preset")), presetSelect.root, savePresetButton, presetDesc);

  const grid = el("div", "param-grid");
  const inputs = new Map<string, HTMLInputElement>();
  let paramSignature = "";
  function rebuildParamGrid(): void {
    const params = paramsForConfig(store.config as Record<string, unknown>);
    const signature = params.map((meta) => meta.key).join("|");
    if (signature === paramSignature) return;
    paramSignature = signature;
    inputs.clear();
    grid.innerHTML = "";
    for (const [index, meta] of params.entries()) {
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
        else if (item.key === "output_mode") {
          store.setParam("output_mode", on ? "native" : "bucket");
          if (on) store.setParam("output_format", "png");
        }
        else if (item.key === "dedup_mode") store.setParam("dedup_mode", on ? "strong" : "standard");
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
  const gpuStatusText = el("span", "resource-status-text");
  const retryGpu = el("button", "resource-retry", "RETRY GPU DOWNLOAD");
  retryGpu.type = "button";
  retryGpu.addEventListener("click", () => void store.setGpuEnabled(true));
  gpuStatus.append(gpuStatusText, retryGpu);
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
    rebuildParamGrid();
    presetSelect.setValue(store.presetName);
    presetDesc.textContent = store.presetDescription();
    for (const meta of paramsForConfig(store.config as Record<string, unknown>)) {
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
        : item.key === "output_mode"
          ? store.config.output_mode === "native"
          : item.key === "dedup_mode"
            ? store.config.dedup_mode === "strong"
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
    if (gpu.status === "idle") gpuStatusText.textContent = "GPU RUNTIME — OFF";
    else if (gpu.status === "checking") gpuStatusText.textContent = "GPU RUNTIME — DETECTING";
    else if (gpu.status === "downloading") gpuStatusText.textContent = `GPU RUNTIME — DOWNLOADING ${gpu.progress}% ${gpu.message}`;
    else if (gpu.status === "ready") gpuStatusText.textContent = `GPU RUNTIME — READY · ${gpu.hardware?.gpu_name || gpu.hardware?.vendor || "GPU"}`;
    else gpuStatusText.textContent = `GPU RUNTIME — ERROR · ${gpu.message}`;
    retryGpu.hidden = gpu.status !== "error" || !gpu.runtime?.can_download;
  }

  body.append(presetRow, grid, switchGrid, gpuStatus, validateStatus);
  const panelTag = (): string => store.config.output_mode === "native"
    ? `NATIVE SOURCE // PROXY ${store.config.dedup_proxy_edge ?? 768}`
    : `BUCKET ${store.config.resolution ?? 1024} // STEP ${store.config.bucket_step ?? 64}`;
  const tag = panelTag();
  const panel = renderPanel({ code: "02", title: t("parameters"), tag, body: [body] });
  inner.append(panel);
  root.append(inner, presetModal);

  const unsubscribe = store.subscribe(() => {
    render();
    const headerTag = panel.querySelector<HTMLElement>(".ptag");
    if (headerTag) headerTag.textContent = panelTag();
  });
  render();
  void runValidate();
  return { root, destroy: () => {
    unsubscribe();
    presetSelect.destroy();
  } };
}
