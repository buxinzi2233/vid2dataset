//! Toast: transient status notification bottom-right.

import { el } from "./el";

let timeout: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, isError = false): void {
  let toast = document.querySelector<HTMLElement>(".toast");
  if (!toast) {
    toast = el("div", "toast");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("err", isError);
  toast.classList.add("show");
  clearTimeout(timeout);
  timeout = setTimeout(() => toast?.classList.remove("show"), 2600);
}
