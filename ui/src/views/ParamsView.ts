//! Params view: preset + parameter grid + switches.

import { renderPanel } from "../components/Panel";
import type { Store } from "../state/store";

export function renderParamsView(_store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";
  const grid = document.createElement("div");
  grid.className = "param-grid";
  const panel = renderPanel({ code: "02", title: "PARAMETERS", tag: "BUCKET 1024 // STEP 64", body: [grid] });
  root.append(panel);
  return root;
}
