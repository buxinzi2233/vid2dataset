//! Switch: labelled toggle checkbox.

import { el } from "./el";

export interface SwitchProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export function renderSwitch(props: SwitchProps): HTMLLabelElement {
  const label = el("label", "sw");
  if (props.checked) label.classList.add("on");
  const box = el("span", "box");
  const text = el("span", undefined, props.label);
  label.append(box, text);
  label.addEventListener("click", () => {
    const next = !label.classList.contains("on");
    label.classList.toggle("on", next);
    props.onChange?.(next);
  });
  return label;
}
