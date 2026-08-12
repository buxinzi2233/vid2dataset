//! Header theme toggle: applies dark/light header vars on `body`.

import { HEAD, type HeadTheme } from "./tokens";

let current: HeadTheme = "dark";

/** Apply the header theme by setting CSS vars on `body`. */
export function applyHead(theme: HeadTheme): void {
  current = theme;
  const h = HEAD[theme];
  const s = document.body.style;
  s.setProperty("--hbg", h.bg);
  s.setProperty("--hfg", h.fg);
  s.setProperty("--hcode", h.code);
  s.setProperty("--hsubtle", h.subtle);
}

export function getHeadTheme(): HeadTheme {
  return current;
}

export function toggleHead(): HeadTheme {
  applyHead(current === "dark" ? "light" : "dark");
  return current;
}
