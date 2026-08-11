//! Tiny DOM builder shared by components (DRY, avoids per-component helpers).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Append children to a parent; returns the parent for chaining. */
export function append(parent: HTMLElement, ...children: (Node | null)[]): HTMLElement {
  for (const c of children) {
    if (c) parent.append(c);
  }
  return parent;
}
