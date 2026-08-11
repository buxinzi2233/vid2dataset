//! Console: dark mono log panel.

import { el } from "./el";

export function renderConsole(): HTMLElement {
  return el("div", "console");
}

export function appendLogLine(consoleEl: HTMLElement, line: string): void {
  const ln = el("div", "ln", line);
  consoleEl.append(ln);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
