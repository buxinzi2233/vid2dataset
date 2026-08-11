//! Execute view: run strip + scan + progress + console + open output.

import { renderConsole, appendLogLine } from "../components/Console";
import { renderButton } from "../components/Button";
import {
  asCommandError,
  cancelRun,
  openFolder,
  startRun,
} from "../api/ipc";
import {
  onExtractDone,
  onExtractError,
  onExtractLog,
  onExtractProgress,
} from "../api/events";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

export function renderExecuteView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const strip = el("div", "run-strip");
  const runBtn = renderButton({ label: t("extract_big"), variant: "fill" });
  const side = el("div", "btn-side");
  const advBtn = renderButton({ label: t("advanced"), variant: "orange" });
  const cancelBtn = renderButton({ label: t("cancel"), variant: "danger", disabled: true });
  side.append(advBtn, cancelBtn);
  strip.append(runBtn, side);

  const scan = el("div", "scan");
  scan.append(el("div", "sweep"));

  const prog = el("div", "prog");
  const progFill = el("div", "fill");
  prog.append(progFill);

  const status = el("div", "status", t("ready"));

  const open = renderButton({
    label: "OPEN OUTPUT",
    variant: "ghost",
    onClick: async () => {
      const path = store.outputPath || "output";
      try {
        await openFolder(path);
        status.textContent = t("open_done", { path });
        status.className = "status";
      } catch (e) {
        const err = asCommandError(e);
        status.textContent = err?.message ?? String(e);
        status.className = "status err";
      }
    },
  });

  const console = renderConsole();
  root.append(strip, scan, prog, status, console, open);

  // ── Run lifecycle ─────────────────────────────────────────────
  function setBusy(busy: boolean): void {
    runBtn.disabled = busy;
    cancelBtn.disabled = !busy;
    scan.classList.toggle("busy", busy);
  }

  function buildConfig(): Record<string, unknown> {
    return {
      input: store.inputPath || "output",
      output: store.outputPath || "output",
      ...store.config,
    };
  }

  function wireEvents(): void {
    void onExtractProgress((e) => {
      if (e.stage === "video") {
        const pct = e.total > 0 ? Math.round((e.current / e.total) * 100) : 0;
        progFill.style.width = `${pct}%`;
        status.textContent = `Processing video ${e.current}/${e.total}…`;
      } else {
        status.textContent = `${e.stage}: ${e.current}/${e.total}`;
      }
    });

    void onExtractLog((e) => appendLogLine(console, e.line));

    void onExtractDone((e) => {
      progFill.style.width = "100%";
      status.textContent = t("run_done", { count: e.total_written, time: e.elapsed_s.toFixed(1) });
      setBusy(false);
    });

    void onExtractError((e) => {
      status.textContent = t("run_error", { msg: e.message });
      status.className = "status err";
      setBusy(false);
    });
  }

  runBtn.addEventListener("click", async () => {
    if (!store.inputPath) {
      status.textContent = t("no_input");
      status.className = "status err";
      return;
    }
    status.textContent = t("run_started");
    status.className = "status";
    setBusy(true);
    try {
      await startRun(buildConfig() as never);
    } catch (e) {
      status.textContent = t("run_error", { msg: String(e) });
      status.className = "status err";
      setBusy(false);
    }
  });

  cancelBtn.addEventListener("click", async () => {
    status.textContent = t("cancelling");
    try {
      await cancelRun();
    } catch (e) {
      status.textContent = String(e);
    }
  });

  wireEvents();
  return root;
}
