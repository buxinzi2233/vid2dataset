//! Inspector: right param-parsing column (collapsed tab + expanded panel).

import { append, el } from "./el";

export interface InspectorProps {
  onOpen?: () => void;
  onClose?: () => void;
}

export function renderInspector(props: InspectorProps): HTMLElement {
  const inspector = el("aside", "inspector");

  const tab = el("div", "insp-tab", "INSPECT");
  tab.addEventListener("click", () => {
    if (!inspector.classList.contains("open")) props.onOpen?.();
    inspector.classList.toggle("open");
  });

  const panel = el("div", "insp-panel");
  const bar = el("div", "ibar");
  bar.append(el("span", undefined, "INSPECT"), el("span", "tag", "RL-PARSE"));
  const body = el("div", "ibody");
  body.append(el("div", "view-hint", "// param parsing — filled by feature task"));
  append(panel, bar, body);
  append(inspector, tab, panel);
  return inspector;
}
