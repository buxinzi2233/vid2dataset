//! Roster view: summary strip + per-video cards.

import { renderPanel } from "../components/Panel";
import type { Store } from "../state/store";

export function renderRosterView(_store: Store): HTMLElement {
  const root = document.createElement("div");
  root.className = "view inner";
  const body = document.createElement("div");
  body.className = "roster";
  root.append(renderPanel({ code: "04", title: "VIDEO ROSTER", tag: "0 FILES", body: [body] }));
  return root;
}
