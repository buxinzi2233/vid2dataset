import { asCommandError, openFolder } from "../api/ipc";
import { renderButton } from "../components/Button";
import { appendLogLine, renderConsole } from "../components/Console";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

export interface ExecuteViewOptions {
  onAdvanced?: () => void;
}

export interface ExecuteView {
  root: HTMLElement;
  run: () => void;
  destroy: () => void;
}

export function renderExecuteView(store: Store, options: ExecuteViewOptions = {}): ExecuteView {
  const root = el("section", "view");
  root.dataset.view = "execute";
  const inner = el("div", "inner");
  const head = el("div", "exec-head");
  const live = el("span", "live", "● RUNNING");
  head.append(el("h2", undefined, t("execute")), live);

  const strip = el("div", "run-strip");
  const runButton = el("button", "btn-run", t("extract_big"));
  runButton.type = "button";
  runButton.dataset.run = "true";
  const side = el("div", "btn-side");
  const advanced = renderButton({ label: t("advanced"), variant: "orange", className: "adv", onClick: () => options.onAdvanced?.() });
  const cancel = renderButton({ label: t("cancel"), variant: "danger", className: "cancel", disabled: true, onClick: () => void cancelRun() });
  side.append(advanced, cancel);
  strip.append(runButton, side);

  const scan = el("div", "scan");
  scan.append(el("div", "sweep"));
  const progress = el("div", "prog");
  const progressFill = el("div", "fill");
  progress.append(progressFill);
  const status = el("div", "status", t("ready"));
  const console = renderConsole();
  const actions = el("div", "exec-actions");
  const openOutput = renderButton({ label: t("open_output"), onClick: () => void openOutputFolder() });
  actions.append(openOutput);
  inner.append(head, strip, scan, progress, status, console, actions);
  root.append(inner);

  let renderedLogCount = 0;
  function render(): void {
    const busy = store.run.status === "running" || store.run.status === "cancelling";
    runButton.disabled = busy;
    cancel.disabled = store.run.status !== "running";
    runButton.classList.toggle("busy", busy);
    live.classList.toggle("on", busy);
    progressFill.style.width = `${store.run.progress}%`;
    status.className = `status${store.run.status === "error" ? " error" : ""}`;

    if (store.run.log.length < renderedLogCount) {
      console.innerHTML = "";
      renderedLogCount = 0;
    }
    for (const line of store.run.log.slice(renderedLogCount)) appendLogLine(console, line);
    renderedLogCount = store.run.log.length;

    if (store.run.status === "cancelling") status.textContent = t("cancelling");
    else if (store.run.status === "done") status.textContent = t("run_done", { count: store.run.totalWritten, time: store.run.elapsedSeconds.toFixed(1) });
    else if (store.run.status === "error") status.textContent = t("run_error", { msg: store.run.errorMessage });
    else if (store.run.status === "running" && store.run.stage === "video") status.textContent = t("processing_video", { current: store.run.current, total: store.run.total });
    else if (store.run.status === "running" && store.run.stage === "proxy") status.textContent = t("stage_proxy", { current: store.run.current });
    else if (store.run.status === "running" && store.run.stage === "strong-dedup") status.textContent = t("stage_strong_dedup", { current: store.run.current, total: store.run.total });
    else if (store.run.status === "running" && store.run.stage === "native-write") status.textContent = t("stage_native_write", { current: store.run.current, total: store.run.total });
    else if (store.run.status === "running" && store.run.stage) status.textContent = `${store.run.stage} · ${store.run.current}/${store.run.total}`;
    else if (store.run.status === "running") status.textContent = t("run_started");
    else status.textContent = t("ready");
  }

  async function startRun(): Promise<void> {
    if (!store.inputPath) {
      status.className = "status error";
      status.textContent = t("no_input");
      return;
    }
    try {
      await store.start();
    } catch (error) {
      store.run.fail(String(error));
    }
  }

  async function cancelRun(): Promise<void> {
    try {
      await store.cancel();
    } catch (error) {
      status.className = "status error";
      status.textContent = String(error);
    }
  }

  async function openOutputFolder(): Promise<void> {
    const path = store.outputPath || "output";
    try {
      await openFolder(path);
      status.className = "status";
      status.textContent = t("open_done", { path });
    } catch (error) {
      const structured = asCommandError(error);
      status.className = "status error";
      status.textContent = structured?.message ?? String(error);
    }
  }

  runButton.addEventListener("click", () => void startRun());
  const unsubscribe = store.subscribe(render);
  render();
  return { root, run: () => void startRun(), destroy: unsubscribe };
}
