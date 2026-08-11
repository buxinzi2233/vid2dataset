//! i18n: dictionary lookup with `{var}` interpolation.

import { en } from "./en";
import { zh } from "./zh";

export type Lang = "en" | "zh";

const dicts: Record<Lang, Record<string, string>> = { en, zh };
let current: Lang = "zh";

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
