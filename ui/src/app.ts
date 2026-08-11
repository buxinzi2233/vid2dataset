//! App shell: top bar + left rail + viewport + right inspector.

import { renderInspector } from "./components/Inspector";
import { renderSourceView } from "./views/SourceView";
import { renderParamsView } from "./views/ParamsView";
import { renderCaptionView } from "./views/CaptionView";
import { renderRosterView } from "./views/RosterView";
import { renderExecuteView } from "./views/ExecuteView";
import { applyHead } from "./theme/theme";
import { applyTokenVars, SHELL } from "./theme/tokens";
import { Store } from "./state/store";

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

function buildViewport(store: Store): HTMLElement {
  const viewport = el("main", "viewport");
  viewport.append(
    renderSourceView(store),
    renderParamsView(store),
    renderCaptionView(store),
    renderRosterView(store),
    renderExecuteView(store),
  );
  return viewport;
}

export function renderApp(root: HTMLElement): void {
  applyTokenVars();
  applyHead("dark");

  const store = new Store();
  void store.init();

  const app = el("div", "app");
  const work = el("div", "work");
  work.append(buildRail(), buildViewport(store), renderInspector({}));
  app.append(buildTopBar(), work);

  root.style.width = `${SHELL.designW}px`;
  root.style.height = `${SHELL.designH}px`;
  root.append(app);
}
