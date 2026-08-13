import { t } from "../i18n";
import { SWITCHES, paramsForConfig, type SwitchMeta } from "../state/paramMeta";
import type { Store } from "../state/store";
import { el } from "./el";

export interface Inspector {
  root: HTMLElement;
  destroy: () => void;
}

export function renderInspector(store: Store): Inspector {
  const root = el("aside", "inspector");
  const tab = el("button", "insp-tab");
  tab.type = "button";
  tab.title = t("inspect");
  tab.append(el("span", "tabdot"), el("span", "tabword", t("inspect")), el("span", "tabarrow", "‹"));
  tab.addEventListener("click", () => store.setInspectorOpen(!store.inspectorOpen));

  const panel = el("div", "insp-panel");
  const bar = el("div", "ibar");
  bar.append(el("span", undefined, t("inspect")), el("span", "tag", "RL-PARSE"));
  const body = el("div", "ibody");
  const code = el("div", "i-code");
  const title = el("div", "i-title");
  const value = el("div", "i-value");
  const description = el("div", "i-desc");
  const section = el("div", "i-sec", t("cfg_summary"));
  const summary = el("div", "i-summary");
  body.append(code, title, value, description, section, summary);
  panel.append(bar, body);
  root.append(tab, panel);

  function switchValue(item: SwitchMeta): string {
    if (item.key === "decode_mode") {
      return store.config.decode_mode === "keyframe" ? t("keyframe_on") : t("accurate_off");
    }
    const enabled = item.key === "output_mode"
      ? store.config.output_mode === "native"
      : item.key === "dedup_mode"
        ? store.config.dedup_mode === "strong"
        : Boolean(store.config[item.key as keyof typeof store.config]);
    const state = enabled ? t("enabled") : t("disabled");
    if (item.key === "gpu_accel" && enabled) return `${state} · ${store.gpu.status.toUpperCase()}`;
    return state;
  }

  function appendSummaryHeading(label: string): void {
    summary.append(el("div", "i-group", label));
  }

  function render(): void {
    root.classList.toggle("open", store.inspectorOpen);
    const params = paramsForConfig(store.config as Record<string, unknown>);
    const paramIndex = params.findIndex((item) => item.key === store.selectedParam);
    const switchIndex = SWITCHES.findIndex((item) => item.key === store.selectedParam);
    const selectedParam = paramIndex >= 0 ? params[paramIndex] : null;
    const selectedSwitch = switchIndex >= 0 ? SWITCHES[switchIndex] : null;
    const fallback = params[0];

    if (selectedSwitch) {
      code.textContent = `S.${String(switchIndex + 1).padStart(2, "0")}`;
      title.textContent = selectedSwitch.label;
      value.textContent = switchValue(selectedSwitch);
      description.textContent = selectedSwitch.tip;
    } else {
      const selected = selectedParam ?? fallback;
      const index = selectedParam ? paramIndex : 0;
      code.textContent = `P.${String(index + 1).padStart(2, "0")}`;
      title.textContent = selected.label;
      const raw = store.config[selected.key as keyof typeof store.config];
      value.textContent = `${raw ?? "—"}${selected.unit ? ` ${selected.unit}` : ""}`;
      description.textContent = selected.tip;
    }

    summary.innerHTML = "";
    appendSummaryHeading(t("numeric_params"));
    for (const [index, item] of params.entries()) {
      const row = el("button", `i-row${item.key === store.selectedParam ? " selected" : ""}`);
      row.type = "button";
      const top = el("span", "row-top");
      top.append(el("span", "rkey", `P.${String(index + 1).padStart(2, "0")}`), el("span", "rname", item.label));
      const rowValue = store.config[item.key as keyof typeof store.config];
      const val = el("span", "row-val");
      val.append(el("span", "rval", String(rowValue ?? "—")), el("span", "runit", item.unit ? ` ${item.unit}` : ""));
      row.append(top, val);
      row.addEventListener("click", () => store.selectParam(item.key, true));
      summary.append(row);
    }
    appendSummaryHeading(t("feature_switches"));
    for (const [index, item] of SWITCHES.entries()) {
      const row = el("button", `i-row switch-row${item.key === store.selectedParam ? " selected" : ""}`);
      row.type = "button";
      const top = el("span", "row-top");
      top.append(el("span", "rkey", `S.${String(index + 1).padStart(2, "0")}`), el("span", "rname", item.label));
      const val = el("span", "row-val");
      val.append(el("span", "rval", switchValue(item)));
      row.append(top, val);
      row.addEventListener("click", () => store.selectParam(item.key, true));
      summary.append(row);
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && store.inspectorOpen) store.setInspectorOpen(false);
  };
  document.addEventListener("keydown", onKeyDown);
  const unsubscribe = store.subscribe(render);
  render();
  return {
    root,
    destroy: () => {
      unsubscribe();
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
