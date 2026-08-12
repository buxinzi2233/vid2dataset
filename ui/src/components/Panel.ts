//! Panel: hairline-framed section with a code/title/tag header.

import { append, el } from "./el";

export interface PanelProps {
  code: string;
  title: string;
  tag?: string;
  body?: HTMLElement[];
  bodyClass?: string;
}

export function renderPanel(props: PanelProps): HTMLElement {
  const panel = el("section", "panel");
  const head = el("div", "phead");
  head.append(el("span", "code", props.code));
  head.append(el("span", "ptitle", props.title));
  if (props.tag) head.append(el("span", "ptag", props.tag));
  const body = el("div", `pbody ${props.bodyClass ?? ""}`.trim());
  append(body, ...(props.body ?? []));
  return append(panel, head, body);
}
