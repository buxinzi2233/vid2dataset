import { renderButton } from "../components/Button";
import { renderPanel } from "../components/Panel";
import { renderSwitch } from "../components/Switch";
import { renderSelectMenu } from "../components/SelectMenu";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

export interface CaptionView {
  root: HTMLElement;
  destroy: () => void;
}

const MODELS: Record<string, string> = {
  "wd-eva02-large-tagger-v3": "wd-eva02-large · ~1.2 GB",
  "wd-swinv2-tagger-v3": "wd-swinv2 · ~450 MB",
};

const FIELDS = [
  { key: "trigger_word", labelKey: "trigger", placeholder: "mychar_v1" },
  { key: "tag_blacklist", labelKey: "blacklist", placeholder: "watermark, signature" },
  { key: "tag_require", labelKey: "require", placeholder: "1girl" },
  { key: "tag_exclude", labelKey: "reject", placeholder: "multiple girls" },
  { key: "trait_prune_threshold", labelKey: "prune", placeholder: "0" },
];

export function renderCaptionView(store: Store): CaptionView {
  const root = el("section", "view");
  root.dataset.view = "caption";
  const inner = el("div", "inner");
  const body = el("div");
  const toggleRow = el("div", "cap-toggle");
  const autoTag = renderSwitch({
    label: t("tag_images"),
    checked: Boolean(store.config.tag_images),
    onChange: (on) => store.setParam("tag_images", on),
  });
  const modelSelect = renderSelectMenu({
    options: Object.keys(MODELS).map((model) => ({ value: model, label: model })),
    value: String(store.config.tagger_model ?? Object.keys(MODELS)[0]),
    className: "tagger-model-select",
    ariaLabel: t("tagger_model"),
    onChange: (value) => {
      store.setParam("tagger_model", value);
      void store.inspectTagger(value);
    },
  });
  toggleRow.append(autoTag, modelSelect.root);

  const fieldGrid = el("div", "cap-fields");
  const inputs = new Map<string, HTMLInputElement>();
  for (const field of FIELDS) {
    const wrap = el("label", "cap-field");
    wrap.append(el("span", "clabel", t(field.labelKey)));
    const input = el("input");
    input.placeholder = field.placeholder;
    input.value = String(store.config[field.key as keyof typeof store.config] ?? "");
    input.addEventListener("input", () => {
      const value = field.key === "trait_prune_threshold" ? Number.parseFloat(input.value) || 0 : input.value;
      store.setParam(field.key, value);
    });
    wrap.append(input);
    fieldGrid.append(wrap);
    inputs.set(field.key, input);
  }
  const modelInfoWrap = el("label", "cap-field");
  modelInfoWrap.append(el("span", "clabel", t("tagger_model")));
  const modelInfo = el("input");
  modelInfo.disabled = true;
  modelInfoWrap.append(modelInfo);
  fieldGrid.append(modelInfoWrap);

  const hint = el("div", "cap-hint", t("caption_hint"));
  const run = renderButton({ label: "RUN TAGGER", variant: "fill", className: "tagger-run", onClick: () => void store.startTagger() });
  const progress = el("div", "tagger-progress");
  progress.append(el("div", "fill"));
  const status = el("div", "resource-status");
  body.append(toggleRow, fieldGrid, hint, run, progress, status);
  inner.append(renderPanel({ code: "03", title: t("captioning"), tag: "WD-TAGGER", body: [body] }));
  root.append(inner);

  function render(): void {
    autoTag.classList.toggle("on", Boolean(store.config.tag_images));
    modelSelect.setValue(String(store.config.tagger_model ?? modelSelect.getValue()));
    modelInfo.value = MODELS[modelSelect.getValue()] ?? modelSelect.getValue();
    const autoTagInput = autoTag.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (autoTagInput) autoTagInput.checked = Boolean(store.config.tag_images);
    for (const field of FIELDS) {
      const input = inputs.get(field.key);
      if (input && document.activeElement !== input) input.value = String(store.config[field.key as keyof typeof store.config] ?? "");
    }
    const tagger = store.tagger;
    run.disabled = ["checking", "downloading", "running"].includes(tagger.status);
    progress.classList.toggle("show", tagger.status === "downloading" || tagger.status === "running");
    const fill = progress.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${tagger.progress}%`;
    status.className = `resource-status ${tagger.status === "error" ? "err" : ["ready", "done"].includes(tagger.status) ? "ok" : ""}`;
    if (tagger.status === "checking") status.textContent = "TAGGER — CHECKING MODEL";
    else if (tagger.status === "missing") status.textContent = `TAGGER — MODEL MISSING · ${tagger.info?.size_mb ?? 0} MB · RUN WILL DOWNLOAD`;
    else if (tagger.status === "downloading") status.textContent = `TAGGER — DOWNLOADING ${tagger.progress}% ${tagger.message}`;
    else if (tagger.status === "running") status.textContent = `TAGGER — RUNNING ${tagger.progress}%`;
    else if (tagger.status === "done") status.textContent = `TAGGER — DONE · ${tagger.result?.tagged ?? 0}/${tagger.result?.total ?? 0} TAGGED`;
    else if (tagger.status === "error") status.textContent = `TAGGER — ERROR · ${tagger.message === "no-output" ? t("no_output") : tagger.message}`;
    else if (tagger.status === "ready") status.textContent = "TAGGER — MODEL READY";
    else status.textContent = "TAGGER — STANDBY";
  }

  const unsubscribe = store.subscribe(render);
  render();
  void store.inspectTagger(modelSelect.getValue());
  return { root, destroy: () => {
    unsubscribe();
    modelSelect.destroy();
  } };
}
