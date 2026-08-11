//! Execute view: run strip + progress + console + open output.

import { renderConsole } from "../components/Console";
import { renderButton } from "../components/Button";
import { openFolder } from "../api/ipc";
import type { Store } from "../state/store";

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
        status.textContent = `OPENED — ${res.opened}`;
        status.className = "validate-status ok";
      } catch (e) {
        status.textContent = `OPEN — error: ${String(e)}`;
        status.className = "validate-status err";
      }
    },
  });

  const console = renderConsole();
  root.append(strip, console, open, status);
  return root;
}
