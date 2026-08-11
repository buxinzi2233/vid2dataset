//! Execute view: run strip + progress + console + open output.

import { renderConsole } from "../components/Console";
import { renderButton } from "../components/Button";
import { asCommandError, openFolder } from "../api/ipc";
import { t } from "../i18n";
import type { Store } from "../state/store";

/** Map a structured open-folder error code to a friendly i18n message. */
function openErrorText(code: string, path: string): string {
  switch (code) {
    case "PATH_NOT_FOUND":
      return t("open_not_found", { path });
    case "NOT_A_DIRECTORY":
      return t("open_not_dir", { path });
    case "PERMISSION_DENIED":
      return t("open_permission", { path });
    case "OPEN_FAILED":
      return t("open_failed", { path });
    default:
      return t("open_unknown", { path });
  }
}

export function renderExecuteView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const strip = document.createElement("div");
  strip.className = "run-strip";
  const run = renderButton({ label: "EXTRACT DATASET", variant: "fill" });
  const side = document.createElement("div");
  side.className = "btn-side";
  side.append(renderButton({ label: "ADVANCED…", variant: "orange" }));
  side.append(renderButton({ label: "CANCEL", variant: "danger", disabled: true }));
  strip.append(run, side);

  const status = document.createElement("div");
  status.className = "validate-status";

  const open = renderButton({
    label: "OPEN OUTPUT",
    variant: "ghost",
    onClick: async () => {
      const path = store.outputPath || "output";
      try {
        const res = await openFolder(path);
        status.textContent = t("open_done", { path: res.opened });
        status.className = "validate-status ok";
      } catch (e) {
        const err = asCommandError(e);
        status.textContent = openErrorText(err?.code ?? "OPEN_UNKNOWN", path);
        status.className = "validate-status err";
      }
    },
  });

  const console = renderConsole();
  root.append(strip, console, open, status);
  return root;
}
