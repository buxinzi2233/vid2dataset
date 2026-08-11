//! App shell: top bar + left rail + viewport + right inspector.

import { renderInspector } from "./components/Inspector";
import { renderSwitch } from "./components/Switch";
import { renderModal, showModal } from "./components/Modal";
import { renderButton } from "./components/Button";import { renderSourceView } from "./views/SourceView";
import { renderParamsView } from "./views/ParamsView";
import { renderCaptionView } from "./views/CaptionView";
import { renderRosterView } from "./views/RosterView";
import { renderExecuteView } from "./views/ExecuteView";
import { applyHead } from "./theme/theme";
import { applyTokenVars, SHELL } from "./theme/tokens";
import { checkUpdateInfo, gpuDetect, gpuDownload, gpuStatus, installUpdate } from "./api/ipc";
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

  // GPU acceleration switch with live hardware detection result.
  const gpuWrap = el("div", "gpu-wrap");
  const gpuStatusText = el("span", "gpu-status");
  gpuStatusText.textContent = "GPU —";
  const gpuSwitch = renderSwitch({ label: "GPU", checked: false });
  gpuSwitch.addEventListener("click", async () => {
    const on = gpuSwitch.classList.contains("on");
    if (!on) {
      gpuStatusText.textContent = "GPU — detecting…";
      try {
        const [hw, st] = await Promise.all([gpuDetect(), gpuStatus()]);
        if (st.available) {
          gpuStatusText.textContent = `GPU — ${hw.gpu_name || hw.vendor} (runtime ready)`;
        } else {
          gpuStatusText.textContent = `GPU — ${hw.gpu_name || hw.vendor} (downloading…)`;
          try {
            await gpuDownload();
            gpuStatusText.textContent = `GPU — ${hw.gpu_name || hw.vendor} (download started)`;
          } catch (e2) {
            gpuStatusText.textContent = `GPU — download error: ${String(e2)}`;
          }
        }
      } catch (e) {
        gpuStatusText.textContent = `GPU — error: ${String(e)}`;
      }
    } else {
      gpuStatusText.textContent = "GPU —";
    }
  });
  gpuWrap.append(gpuSwitch, gpuStatusText);

  const lang = el("button", "btn");
  lang.textContent = "中文 / EN";
  const cancel = el("button", "btn danger");
  cancel.textContent = "CANCEL";
  const run = el("button", "btn fill");
  run.textContent = "EXTRACT";
  actions.append(gpuWrap, lang, cancel, run);

  bar.append(id, el("div", "spacer"), actions);
  return bar;
}

function buildRail(onAbout: () => void): HTMLElement {
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
  const footLine = el("div", "");
  footLine.textContent = "SESSION — · STANDBY";
  const aboutBtn = renderButton({ label: "ABOUT", variant: "ghost", onClick: onAbout });
  foot.append(footLine, aboutBtn);

  rail.append(abbr, label, nav, foot);
  return rail;
}

function buildAboutModal(onClose: () => void): HTMLElement {
  const note = el("div", "validate-status");
  const checkBtn = renderButton({
    label: "CHECK UPDATE",
    variant: "orange",
    onClick: async () => {
      note.textContent = "Checking…";
      try {
        const info = await checkUpdateInfo();
        note.textContent = info.available
          ? `Update available: v${info.version ?? "?"}`
          : "You have the latest version";
      } catch (e) {
        note.textContent = `Update check error: ${String(e)}`;
      }
    },
  });
  const installBtn = renderButton({
    label: "INSTALL",
    variant: "fill",
    onClick: async () => {
      note.textContent = "Installing…";
      try {
        const res = await installUpdate();
        note.textContent = res.installed ? "Update staged — restart to apply" : `Not installed: ${res.reason ?? "?"}`;
      } catch (e) {
        note.textContent = `Install error: ${String(e)}`;
      }
    },
  });
  const actions = el("div", "about-actions");
  actions.append(checkBtn, installBtn);
  const title = el("div", "i-title");
  title.textContent = "vid2dataset V1.2.0";
  const body = el("div", "");
  body.append(title, actions, note);
  return renderModal({ title: "ABOUT", tag: "RL-EXTRACT-OS", width: 420, body: [body], onClose });
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

  const aboutModal = buildAboutModal(() => showModal(aboutModal, false));
  document.body.append(aboutModal);

  const app = el("div", "app");
  const work = el("div", "work");
  work.append(buildRail(() => showModal(aboutModal, true)), buildViewport(store), renderInspector({}));
  app.append(buildTopBar(), work);

  root.style.width = `${SHELL.designW}px`;
  root.style.height = `${SHELL.designH}px`;
  root.append(app);
}
