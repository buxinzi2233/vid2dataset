//! Source view: input / output panels.

import { renderPanel } from "../components/Panel";
import type { Store } from "../state/store";

export function renderSourceView(_store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view active inner";
  root.append(
    renderPanel({ code: "01a", title: "INPUT", tag: "SRC" }),
    renderPanel({ code: "01b", title: "OUTPUT", tag: "DST" }),
  );
  return root;
}
