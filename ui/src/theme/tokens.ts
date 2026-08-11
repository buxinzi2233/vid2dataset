//! Design tokens distilled from the approved prototype (`layout-b-v2.html`).
//! Single source of truth for colors / fonts / layout constants consumed by the
//! app shell and components.

export const TOKENS = {
  paper: "#dfddd7",
  panel: "#e9e7e1",
  field: "#f4f2ec",
  ink: "#010101",
  grey: "#6b6b66",
  line: "#a6a299",
  accent: "#fc902d",
  accentHover: "#d97a17",
  accentText: "#1a1206",
  alert: "#c2352b",
  alertHover: "#a02820",
} as const;

export const FONTS = {
  mono: '"Roboto Mono", "Consolas", "DejaVu Sans Mono", monospace',
  sans: '"Open Sans", "Noto Sans TC", "Segoe UI", sans-serif',
} as const;

/** Header theme switch: dark bar (default) vs light paper header. */
export const HEAD = {
  dark: { bg: TOKENS.ink, fg: TOKENS.paper, code: TOKENS.accent, subtle: TOKENS.line },
  light: { bg: TOKENS.paper, fg: TOKENS.ink, code: TOKENS.accent, subtle: TOKENS.grey },
} as const;

export type HeadTheme = keyof typeof HEAD;

/** App shell geometry (desktop design canvas). */
export const SHELL = {
  designW: 1440,
  designH: 900,
  topBarH: 64,
  railW: 200,
  railCollapsedW: 28,
  inspW: 200,
} as const;

/** Injects tokens as CSS custom properties on `:root`. */
export function applyTokenVars(): void {
  const s = document.documentElement.style;
  const t = TOKENS;
  s.setProperty("--paper", t.paper);
  s.setProperty("--panel", t.panel);
  s.setProperty("--field", t.field);
  s.setProperty("--ink", t.ink);
  s.setProperty("--grey", t.grey);
  s.setProperty("--line", t.line);
  s.setProperty("--accent", t.accent);
  s.setProperty("--accent-hover", t.accentHover);
  s.setProperty("--accent-text", t.accentText);
  s.setProperty("--alert", t.alert);
  s.setProperty("--alert-hover", t.alertHover);
  s.setProperty("--mono", FONTS.mono);
  s.setProperty("--sans", FONTS.sans);
}
