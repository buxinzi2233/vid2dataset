//! Switch: labelled toggle checkbox.

import { el } from "./el";

export interface SwitchProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  key?: string;
}

export function renderSwitch(props: SwitchProps): HTMLLabelElement {
  const label = el("label", "sw");
  if (props.checked) label.classList.add("on");
  if (props.key) label.dataset.swkey = props.key;
  const input = el("input");
  input.type = "checkbox";
  input.checked = Boolean(props.checked);
  const box = el("span", "box");
  const text = el("span", undefined, props.label);
  label.append(input, box, text);
  input.addEventListener("change", () => {
    label.classList.toggle("on", input.checked);
    props.onChange?.(input.checked);
  });
  return label;
}
