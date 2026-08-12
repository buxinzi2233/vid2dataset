//! Console: dark mono log panel.

import { el } from "./el";

export function renderConsole(): HTMLElement {
  return el("div", "console");
}

export function appendLogLine(consoleEl: HTMLElement, line: string): void {
  const severity = /\[ERROR\]|\berror\b/i.test(line)
    ? "err"
    : /\[WARNING\]|\bwarn/i.test(line)
      ? "warn"
      : /\[INFO\].*(done|written|saved|complete)/i.test(line)
        ? "ok"
        : "";
  const ln = el("div", `ln ${severity}`.trim(), line);
  consoleEl.append(ln);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
