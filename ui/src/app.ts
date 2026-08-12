import {
  onDownloadDone,
  onDownloadProgress,
  onExtractDone,
  onExtractError,
  onExtractLog,
  onExtractProgress,
  onTaggerDone,
} from "./api/events";
import { checkUpdateInfo, installUpdate } from "./api/ipc";
import { renderAdvancedModal } from "./components/AdvancedModal";
import { renderButton } from "./components/Button";
import { renderInspector } from "./components/Inspector";
import { renderModal, showModal } from "./components/Modal";
import { renderSelectMenu } from "./components/SelectMenu";
import { showToast } from "./components/Toast";
import { el } from "./components/el";
import { setLang, t } from "./i18n";
import { Store } from "./state/store";
import { applyHead } from "./theme/theme";
import { applyTokenVars } from "./theme/tokens";
import { renderCaptionView } from "./views/CaptionView";
import { renderExecuteView } from "./views/ExecuteView";
import { renderParamsView } from "./views/ParamsView";
import { renderRosterView } from "./views/RosterView";
import { renderSourceView } from "./views/SourceView";

const VIEW_KEYS = ["source", "params", "caption", "roster", "execute"] as const;
type ViewKey = typeof VIEW_KEYS[number];

interface Disposable {
  destroy: () => void;
}

export function clampZoom(value: number): number {
  return Math.min(1.4, Math.max(0.8, Math.round(value * 10) / 10));
}

function instrumentMark(className: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add(className);
  svg.setAttribute("viewBox", "0 0 56 56");
  const shapes: [string, Record<string, string>][] = [
    ["circle", { cx: "28", cy: "28", r: "24", fill: "none", stroke: "currentColor", "stroke-width": "2" }],
    ["circle", { cx: "28", cy: "28", r: "10", fill: "none", stroke: "var(--line)", "stroke-width": "1" }],
    ["line", { x1: "4", y1: "28", x2: "52", y2: "28", stroke: "var(--line)" }],
    ["line", { x1: "28", y1: "4", x2: "28", y2: "52", stroke: "var(--line)" }],
    ["path", { d: "M 28 4 A 24 24 0 0 1 48.8 16", fill: "none", stroke: "var(--accent)", "stroke-width": "3" }],
    ["circle", { cx: "28", cy: "28", r: "3", fill: "var(--accent)" }],
  ];
  for (const [tag, attributes] of shapes) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

function githubMark(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("about-logo");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z");
  svg.append(path);
  return svg;
}

function bindEvents(store: Store): void {
  void onExtractProgress((event) => {
    if (event.stage === "tag:tagging") store.setTaggerProgress(event.current, event.total);
    else store.run.setProgress(event.total > 0 ? Math.round((event.current / event.total) * 100) : 0, event.stage, event.current, event.total);
  });
  void onExtractLog((event) => store.run.appendLog(event.line));
  void onExtractDone((event) => store.run.finish(event));
  void onExtractError((event) => store.run.fail(event.message));
  void onDownloadProgress((event) => store.handleDownloadProgress(event));
  void onDownloadDone((event) => void store.handleDownloadDone(event));
  void onTaggerDone((event) => store.handleTaggerDone(event));
}

function applyZoom(root: HTMLElement, zoom: number): void {
  root.style.setProperty("--app-zoom", String(zoom));
  root.style.setProperty("--app-zoom-inverse", String(1 / zoom));
}

function buildTopBar(store: Store, onRun: () => void, onLanguage: () => void): HTMLElement {
  const bar = el("header", "runbar");
  bar.append(instrumentMark("mark"));
  const identity = el("div", "id");
  identity.append(el("span", "name", t("appname")), el("span", "code", "DATASET PREPARATION INSTRUMENT // V1.2.0"));
  const spacer = el("div", "spacer");
  const preset = el("div", "preset");
  preset.append(el("span", "plabel", t("preset")));
  const select = renderSelectMenu({
    options: store.presets.map((item) => ({ value: item.name, label: item.user ? `${item.name} *` : item.name })),
    value: store.presetName,
    className: "preset-select",
    ariaLabel: t("preset"),
    onChange: (value) => void store.applyPreset(value),
  });
  select.root.dataset.preset = "top";
  preset.append(select.root);
  let presetSignature = store.presets.map((item) => `${item.name}:${item.user ? 1 : 0}`).join("|");

  const actions = el("div", "actions");
  const zoom = el("div", "zoom");
  const zoomValue = el("span", "zoom-val", `${Math.round(store.zoom * 100)}%`);
  const setZoom = (value: number): void => store.setZoom(clampZoom(value));
  zoom.append(
    renderButton({ label: "−", className: "zoom-btn", title: t("zoom_out"), onClick: () => setZoom(store.zoom - 0.1) }),
    zoomValue,
    renderButton({ label: "+", className: "zoom-btn", title: t("zoom_in"), onClick: () => setZoom(store.zoom + 0.1) }),
    renderButton({ label: "FIT", className: "zoom-btn fit", title: t("zoom_fit"), onClick: () => setZoom(1) }),
  );
  const language = renderButton({ label: "中文 / EN", onClick: onLanguage });
  const cancel = renderButton({ label: t("cancel"), variant: "danger", disabled: true, onClick: () => void store.cancel().catch((error) => showToast(String(error), true)) });
  const run = renderButton({ label: t("extract"), variant: "fill", onClick: onRun });
  actions.append(zoom, language, cancel, run);
  bar.append(identity, spacer, preset, actions);

  const unsubscribe = store.subscribe(() => {
    const nextPresetSignature = store.presets.map((item) => `${item.name}:${item.user ? 1 : 0}`).join("|");
    if (nextPresetSignature !== presetSignature) {
      presetSignature = nextPresetSignature;
      select.setOptions(store.presets.map((item) => ({ value: item.name, label: item.user ? `${item.name} *` : item.name })));
    }
    select.setValue(store.presetName);
    zoomValue.textContent = `${Math.round(store.zoom * 100)}%`;
    const busy = store.run.status === "running" || store.run.status === "cancelling";
    run.disabled = busy;
    cancel.disabled = store.run.status !== "running";
  });
  bar.addEventListener("shell-destroy", () => {
    unsubscribe();
    select.destroy();
  }, { once: true });
  return bar;
}

function buildRail(store: Store, active: ViewKey, onNavigate: (key: ViewKey) => void, onAbout: () => void): HTMLElement {
  const rail = el("aside", "viewrail");
  rail.append(el("div", "abbr", "RL-EXTRACT-OS // V1.2.0"), el("div", "section-label", t("views")));
  const nav = el("nav");
  const labels = ["v_source", "v_params", "v_caption", "v_roster", "v_execute"];
  VIEW_KEYS.forEach((key, index) => {
    const button = el("button", key === active ? "active" : "");
    button.type = "button";
    button.dataset.viewTarget = key;
    button.append(el("span", "code", String(index + 1).padStart(2, "0")), el("span", undefined, t(labels[index])));
    button.addEventListener("click", () => onNavigate(key));
    nav.append(button);
  });
  const foot = el("div", "view-foot");
  const date = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const bucket = el("div", undefined, `BUCKET ${store.config.resolution ?? 1024} // STEP ${store.config.bucket_step ?? 64}`);
  const state = el("div", "rail-run-state");
  state.append(el("span", "st", "●"), el("span", "state-text", t("standby")));
  const buttons = el("div", "foot-btns");
  const theme = renderButton({
    label: store.headTheme === "dark" ? t("theme_light") : t("theme_dark"),
    className: "foot-btn",
    onClick: () => store.setHeadTheme(store.headTheme === "dark" ? "light" : "dark"),
  });
  buttons.append(theme, renderButton({ label: t("about"), className: "foot-btn", onClick: onAbout }));
  foot.append(el("div", undefined, `SESSION ${date}`), bucket, state, buttons);
  rail.append(nav, foot);

  const unsubscribe = store.subscribe(() => {
    bucket.textContent = `BUCKET ${store.config.resolution ?? 1024} // STEP ${store.config.bucket_step ?? 64}`;
    const text = state.querySelector<HTMLElement>(".state-text");
    if (text) text.textContent = t(store.run.status === "running" ? "running" : store.run.status === "cancelling" ? "cancelling" : store.run.status === "error" ? "error" : store.run.status === "done" ? "done_state" : "standby");
    state.className = `rail-run-state ${store.run.status}`;
    theme.textContent = store.headTheme === "dark" ? t("theme_light") : t("theme_dark");
  });
  rail.addEventListener("shell-destroy", unsubscribe, { once: true });
  return rail;
}

function buildAboutModal(): HTMLElement {
  const center = el("div", "about-center");
  center.append(githubMark());
  center.append(el("div", "about-url", "github.com/peter119lee/vid2dataset"));
  const version = el("div", "about-version", "vid2dataset ");
  version.append(el("span", "v", "V1.2.0"));
  const note = el("div", "about-note");
  const actions = el("div", "about-actions");
  const install = renderButton({ label: t("install_update"), variant: "fill" });
  install.hidden = true;
  install.addEventListener("click", async () => {
    note.textContent = t("installing_update");
    try {
      const result = await installUpdate();
      note.textContent = result.installed ? t("update_staged") : t("update_not_installed", { reason: result.reason ?? "unknown" });
    } catch (error) {
      note.textContent = String(error);
    }
  });
  const check = renderButton({ label: t("check_update"), variant: "orange", onClick: async () => {
    note.textContent = t("update_checking");
    install.hidden = true;
    try {
      const info = await checkUpdateInfo();
      note.textContent = info.available ? t("update_available", { version: info.version ?? "?" }) : t("update_latest");
      install.hidden = !info.available;
    } catch (error) {
      note.textContent = String(error);
    }
  } });
  actions.append(check, install);
  center.append(version, actions, note);
  const modal = renderModal({ title: t("about_title"), tag: "RL-EXTRACT-OS", width: 420, body: [center] });
  modal.classList.add("about-modal");
  return modal;
}

export async function renderApp(root: HTMLElement): Promise<void> {
  applyTokenVars();
  const store = new Store();
  await store.init();
  bindEvents(store);
  let active: ViewKey = "source";
  let shellDisposables: Disposable[] = [];

  const renderShell = (): void => {
    for (const disposable of shellDisposables) disposable.destroy();
    root.querySelectorAll<HTMLElement>(".runbar,.viewrail").forEach((node) => node.dispatchEvent(new Event("shell-destroy")));
    shellDisposables = [];
    setLang(store.lang);
    applyHead(store.headTheme);
    document.documentElement.lang = store.lang === "zh" ? "zh-CN" : "en";
    applyZoom(root, store.zoom);

    const app = el("div", "app");
    const work = el("div", "work");
    const viewport = el("main", "viewport");
    const advanced = renderAdvancedModal(store);
    const about = buildAboutModal();
    const execute = renderExecuteView(store, { onAdvanced: advanced.open });
    const roster = renderRosterView(store, { onSelect: () => switchView("execute") });
    const params = renderParamsView(store);
    const caption = renderCaptionView(store);
    viewport.append(renderSourceView(store), params.root, caption.root, roster.root, execute.root);
    shellDisposables.push(params, caption, roster, execute, advanced);

    const switchView = (key: ViewKey): void => {
      active = key;
      viewport.querySelectorAll<HTMLElement>(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === key));
      work.querySelectorAll<HTMLElement>("[data-view-target]").forEach((button) => button.classList.toggle("active", button.dataset.viewTarget === key));
      if (key === "roster") void roster.refresh();
    };

    const top = buildTopBar(store, () => {
      switchView("execute");
      execute.run();
    }, () => {
      store.setLang(store.lang === "zh" ? "en" : "zh");
      renderShell();
    });
    const rail = buildRail(store, active, switchView, () => showModal(about, true));
    const inspector = renderInspector(store);
    shellDisposables.push(inspector);
    work.append(rail, viewport, inspector.root);
    app.append(top, work, about, advanced.root);
    root.replaceChildren(app);
    switchView(active);
  };

  store.subscribe(() => {
    applyHead(store.headTheme);
    applyZoom(root, store.zoom);
  });
  renderShell();
}
