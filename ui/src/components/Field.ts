//! Field: labelled mono input (underline entry).

import { append, el } from "./el";

export interface FieldProps {
  label: string;
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
}

export function renderField(props: FieldProps): HTMLElement {
  const row = el("div", "field-row");
  row.append(el("span", "flabel", props.label));
  const input = el("input");
  if (props.value) input.value = props.value;
  if (props.placeholder) input.placeholder = props.placeholder;
  if (props.onChange) input.addEventListener("input", () => props.onChange?.(input.value));
  const wrap = el("div", "fwrap");
  wrap.append(input);
  return append(row, wrap);
}
