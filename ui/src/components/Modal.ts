//! Modal: ink-bar header + body, backdrop shown/hidden by class.

import { append, el } from "./el";

export interface ModalProps {
  title: string;
  tag?: string;
  width?: number;
  body?: HTMLElement[];
  onClose?: () => void;
}

export function renderModal(props: ModalProps): HTMLElement {
  const backdrop = el("div", "modal-backdrop");
  const modal = el("div", "modal");
  if (props.width) modal.style.width = `${props.width}px`;

  const bar = el("div", "mbar");
  bar.append(el("span", undefined, props.title));
  if (props.tag) bar.append(el("span", "tag", props.tag));
  const close = el("button", "close", "✕");
  close.addEventListener("click", () => {
    backdrop.classList.remove("show");
    props.onClose?.();
  });
  bar.append(close);

  const body = el("div", "mbody");
  append(body, ...(props.body ?? []));
  append(modal, bar, body);
  backdrop.append(modal);
  return backdrop;
}

export function showModal(root: HTMLElement, open: boolean): void {
  root.classList.toggle("show", open);
}
