//! Square custom select used where the native WebView popup cannot match the prototype.

import { el } from "./el";

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectMenuProps {
  options?: SelectMenuOption[];
  value?: string;
  className?: string;
  ariaLabel?: string;
  onChange?: (value: string) => void;
}

export interface SelectMenu {
  root: HTMLDivElement;
  getValue: () => string;
  setValue: (value: string) => void;
  setOptions: (options: SelectMenuOption[]) => void;
  destroy: () => void;
}

export function renderSelectMenu(props: SelectMenuProps): SelectMenu {
  const root = el("div", `select-menu${props.className ? ` ${props.className}` : ""}`);
  const trigger = el("button", "select-trigger");
  trigger.type = "button";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (props.ariaLabel) trigger.setAttribute("aria-label", props.ariaLabel);

  const valueLabel = el("span", "select-value");
  const arrow = el("span", "select-arrow");
  arrow.setAttribute("aria-hidden", "true");
  trigger.append(valueLabel, arrow);

  const list = el("div", "select-options");
  list.setAttribute("role", "listbox");
  root.append(trigger, list);

  let options = [...(props.options ?? [])];
  let value = props.value ?? options.find((option) => !option.disabled)?.value ?? "";
  let activeIndex = -1;

  function selectedIndex(): number {
    return options.findIndex((option) => option.value === value && !option.disabled);
  }

  function enabledIndex(from: number, direction: 1 | -1): number {
    if (!options.length) return -1;
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (from + direction * offset + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return -1;
  }

  function renderOptions(): void {
    list.replaceChildren();
    for (const [index, option] of options.entries()) {
      const item = el("button", "select-option", option.label);
      item.type = "button";
      item.setAttribute("role", "option");
      item.dataset.value = option.value;
      item.disabled = Boolean(option.disabled);
      item.setAttribute("aria-selected", String(option.value === value));
      item.classList.toggle("selected", option.value === value);
      item.classList.toggle("active", index === activeIndex);
      item.addEventListener("pointermove", () => {
        if (!option.disabled && activeIndex !== index) {
          activeIndex = index;
          updateOptionState();
        }
      });
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        choose(index);
      });
      list.append(item);
    }
    const selected = options.find((option) => option.value === value);
    valueLabel.textContent = selected?.label ?? value;
  }

  function updateOptionState(): void {
    list.querySelectorAll<HTMLButtonElement>(".select-option").forEach((item, index) => {
      item.classList.toggle("active", index === activeIndex);
      item.classList.toggle("selected", item.dataset.value === value);
      item.setAttribute("aria-selected", String(item.dataset.value === value));
    });
  }

  function setOpen(open: boolean): void {
    root.classList.toggle("open", open);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      const selected = selectedIndex();
      activeIndex = selected >= 0 ? selected : enabledIndex(-1, 1);
      updateOptionState();
    }
  }

  function choose(index: number): void {
    const option = options[index];
    if (!option || option.disabled) return;
    const changed = option.value !== value;
    value = option.value;
    valueLabel.textContent = option.label;
    activeIndex = index;
    updateOptionState();
    setOpen(false);
    trigger.focus();
    if (changed) props.onChange?.(value);
  }

  trigger.addEventListener("click", () => setOpen(!root.classList.contains("open")));
  root.addEventListener("keydown", (event) => {
    const open = root.classList.contains("open");
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        trigger.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      else {
        activeIndex = enabledIndex(activeIndex, event.key === "ArrowDown" ? 1 : -1);
        updateOptionState();
      }
      return;
    }
    if (open && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      choose(activeIndex);
    }
  });

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!root.contains(event.target as Node)) setOpen(false);
  };
  document.addEventListener("pointerdown", onDocumentPointerDown);

  renderOptions();
  return {
    root,
    getValue: () => value,
    setValue: (next) => {
      value = next;
      const selected = options.find((option) => option.value === value);
      valueLabel.textContent = selected?.label ?? next;
      updateOptionState();
    },
    setOptions: (next) => {
      options = [...next];
      if (!options.some((option) => option.value === value && !option.disabled)) {
        value = options.find((option) => !option.disabled)?.value ?? "";
      }
      activeIndex = selectedIndex();
      renderOptions();
    },
    destroy: () => document.removeEventListener("pointerdown", onDocumentPointerDown),
  };
}
