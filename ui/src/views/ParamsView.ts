//! Params view: preset + parameter grid + validation status.

import { renderPanel } from "../components/Panel";
import { validateConfig } from "../api/ipc";
import type { Store } from "../state/store";

export function renderParamsView(store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";

  const grid = document.createElement("div");
  grid.className = "param-grid";

  const status = document.createElement("div");
  status.className = "validate-status";

  const panel = renderPanel({
    code: "02",
    title: "PARAMETERS",
    tag: "BUCKET 1024 // STEP 64",
    body: [grid, status],
  });
  root.append(panel);

  async function runValidate(): Promise<void> {
    try {
      const result = await validateConfig(store.config);
      if (result.valid) {
        status.textContent = "CONFIG — VALID";
        status.className = "validate-status ok";
      } else {
        status.textContent = `CONFIG — INVALID: ${result.errors
          .map((e) => `${e.field} ${e.message}`)
          .join("; ")}`;
        status.className = "validate-status err";
      }
    } catch (e) {
      status.textContent = `CONFIG — error: ${String(e)}`;
      status.className = "validate-status err";
    }
  }

  void runValidate();
  return root;
}
