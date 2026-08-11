//! Caption view: auto-tag toggle + model + trigger + tag-quality fields.

import { renderPanel } from "../components/Panel";
import { renderButton } from "../components/Button";
import { renderSwitch } from "../components/Switch";
import { runTagger } from "../api/ipc";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

const STRING_FIELDS: { key: string; label: string }[] = [
  { key: "tag_blacklist", label: "BLACKLIST" },
  { key: "tag_require", label: "REQUIRE" },
  { key: "tag_exclude", label: "REJECT IF" },
  { key: "trait_prune_threshold", label: "PRUNE ≥" },
];

export function renderCaptionView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const body = el("div", "cap-fields");

  // Toggle + model + trigger
  const toggleRow = el("div", "cap-toggle");
  toggleRow.append(
    renderSwitch({
      label: t("tag_images"),
      checked: Boolean(store.config.tag_images),
      onChange: (on) => store.setParam("tag_images", on),
    }),
  );
  const modelSelect = el("select", "menu");
  for (const m of ["wd-eva02-large-tagger-v3", "wd-swinv2-tagger-v3"]) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelSelect.append(opt);
  }
  modelSelect.value = String(store.config.tagger_model ?? "wd-eva02-large-tagger-v3");
  modelSelect.addEventListener("change", () => store.setParam("tagger_model", modelSelect.value));
  toggleRow.append(modelSelect);

  const triggerRow = el("div", "cap-field");
  triggerRow.append(el("span", "clabel", t("trigger")));
  const trigger = el("input");
  trigger.value = String(store.config.trigger_word ?? "");
  trigger.addEventListener("input", () => store.setParam("trigger_word", trigger.value));
  triggerRow.append(trigger);

  // Tag-quality string fields
  const fieldsRow = el("div", "cap-fields");
  for (const f of STRING_FIELDS) {
    const row = el("div", "cap-field");
    row.append(el("span", "clabel", f.label));
    const input = el("input");
    input.value = String(store.config[f.key as keyof typeof store.config] ?? "");
    input.addEventListener("input", () => store.setParam(f.key, input.value));
    row.append(input);
    fieldsRow.append(row);
  }

  // Run tagger
  const status = el("div", "validate-status");
  const run = renderButton({
    label: "RUN TAGGER",
    variant: "fill",
    onClick: async () => {
      status.textContent = "TAGGING — running…";
      status.className = "validate-status";
      try {
        const folder = store.outputPath || "output";
        await runTagger({
          folder,
          modelName: modelSelect.value,
          triggerWord: trigger.value,
          blacklist: String(store.config.tag_blacklist ?? ""),
          require: String(store.config.tag_require ?? ""),
          exclude: String(store.config.tag_exclude ?? ""),
        });
        status.textContent = "TAGGING — started (events stream via tagger.done)";
        status.className = "validate-status ok";
      } catch (e) {
        status.textContent = `TAGGING — error: ${String(e)}`;
        status.className = "validate-status err";
      }
    },
  });

  body.append(toggleRow, triggerRow, fieldsRow, run, status);
  root.append(renderPanel({ code: "03", title: t("captioning"), tag: "WD-TAGGER", body: [body] }));
  return root;
}
