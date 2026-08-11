//! Caption view: auto-tag + trigger + tag quality fields.

import { renderPanel } from "../components/Panel";
import type { Store } from "../state/store";

export function renderCaptionView(_store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";
  const body = document.createElement("div");
  body.className = "cap-fields";
  root.append(renderPanel({ code: "03", title: "CAPTIONING", tag: "WD-TAGGER", body: [body] }));
  return root;
}
