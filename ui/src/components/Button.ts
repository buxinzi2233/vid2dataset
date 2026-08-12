//! Button: bordered / filled / danger variants.

import { el } from "./el";

export type ButtonVariant = "ghost" | "fill" | "danger" | "orange";

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  ghost: "",
  fill: "fill",
  danger: "danger",
  orange: "orange",
};

export function renderButton(props: ButtonProps): HTMLButtonElement {
  const btn = el(
    "button",
    `btn ${VARIANT_CLASS[props.variant ?? "ghost"]} ${props.className ?? ""}`.trim(),
    props.label,
  );
  btn.type = "button";
  if (props.title) btn.title = props.title;
  if (props.disabled) btn.disabled = true;
  if (props.onClick) btn.addEventListener("click", props.onClick);
  return btn;
}
