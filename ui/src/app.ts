//! App shell: top bar + left rail + viewport + right inspector.
//!
//! Builds the fixed chrome (structure only, no business logic). View content
//! slots are filled by `views/*` in task 10.

import { applyHead } from "./theme/theme";
import { applyTokenVars, SHELL } from "./theme/tokens";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function buildTopBar(): HTMLElement {
  const bar = el("header", "runbar");
  const id = el("div", "id");
  const name = el("span", "name");
  name.textContent = "VID2DATASET";
  const code = el("span", "code");
  code.textContent = "DATASET PREPARATION INSTRUMENT // V1.2.0";
  id.append(name, code);

  const actions = el("div", "actions");
  const lang = el("button", "btn");
  lang.textContent = "中文 / EN";
  const cancel = el("button", "btn danger");
  cancel.textContent = "CANCEL";
  const run = el("button", "btn fill");
  run.textContent = "EXTRACT";
  actions.append(lang, cancel, run);

  bar.append(id, el("div", "spacer"), actions);
  return bar;
}

function buildRail(): HTMLElement {
  const rail = el("aside", "viewrail");
  const abbr = el("div", "abbr");
  abbr.textContent = "RL-EXTRACT-OS // V1.2.0";
  const label = el("div", "section-label");
  label.textContent = "TERMINAL VIEWS";

  const nav = el("nav", "nav");
  const items = ["SOURCE", "PARAMETERS", "CAPTIONING", "ROSTER", "EXECUTE"];
  items.forEach((title, i) => {
    const b = el("button", i === 0 ? "active" : "");
    const code = el("span", "code");
    code.textContent = String(i + 1).padStart(2, "0");
    b.append(code, document.createTextNode("  " + title));
    nav.append(b);
  });

  const foot = el("div", "view-foot");
  foot.textContent = "SESSION — · STANDBY";

  rail.append(abbr, label, nav, foot);
  return rail;
}

function buildViewport(): HTMLElement {
  const viewport = el("main", "viewport");
  // Placeholder view slot; replaced by views/* in task 10.
  const inner = el("div", "view inner");
  const hint = el("div", "view-hint");
  hint.textContent = "// VIEW SLOT — filled by views/* (task 10)";
  inner.append(hint);
  viewport.append(inner);
  return viewport;
}

function buildInspector(): HTMLElement {
  const inspector = el("aside", "inspector");
  const tab = el("div", "insp-tab");
  tab.textContent = "INSPECT";
  const panel = el("div", "insp-panel");
  const bar = el("div", "ibar");
  bar.textContent = "INSPECT // RL-PARSE";
  panel.append(bar);
  inspector.append(tab, panel);
  return inspector;
}

export function renderApp(root: HTMLElement): void {
  applyTokenVars();
  applyHead("dark");

  const app = el("div", "app");
  const work = el("div", "work");
  work.append(buildRail(), buildViewport(), buildInspector());
  app.append(buildTopBar(), work);

  root.style.width = `${SHELL.designW}px`;
  root.style.height = `${SHELL.designH}px`;
  root.append(app);
}
