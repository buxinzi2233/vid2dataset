//! Execute view: run strip + progress + console.

import { renderConsole } from "../components/Console";
import { renderButton } from "../components/Button";
import type { Store } from "../state/store";

export function renderExecuteView(_store: Store): HTMLElement {
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

  const console = renderConsole();
  root.append(strip, console);
  return root;
}
