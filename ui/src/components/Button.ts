//! Button: bordered / filled / danger variants.

import { el } from "./el";

export type ButtonVariant = "ghost" | "fill" | "danger" | "orange";

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  ghost: "",
  fill: "fill",
  danger: "danger",
  orange: "orange",
};

export function renderButton(props: ButtonProps): HTMLButtonElement {
  const btn = el("button", `btn ${VARIANT_CLASS[props.variant ?? "ghost"]}`.trim(), props.label);
  if (props.disabled) btn.disabled = true;
  if (props.onClick) btn.addEventListener("click", props.onClick);
  return btn;
}
