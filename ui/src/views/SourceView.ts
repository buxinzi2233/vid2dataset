//! Source view: input / output folder fields.

import { renderPanel } from "../components/Panel";
import { renderButton } from "../components/Button";
import { showToast } from "../components/Toast";
import { browseFolder } from "../api/ipc";
import { el } from "../components/el";
import { t } from "../i18n";
import type { Store } from "../state/store";

/** A label + underline input + browse button row (3-col grid). */
function sourceRow(
  label: string,
  value: string,
  placeholder: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = el("div", "source-row");
  row.append(el("span", "flabel", label));
  const input = el("input");
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onChange(input.value));
  row.append(input);
  row.append(
    renderButton({
      label: t("browse"),
      variant: "ghost",
      onClick: async () => {
        try {
          const path = await browseFolder();
          if (path !== null) {
            input.value = path;
            onChange(path);
          }
        } catch (error) {
          showToast(t("browse_error", { msg: String(error) }), true);
        }
      },
    }),
  );
  return row;
}

export function renderSourceView(store: Store): HTMLElement {
  const root = el("section", "view active");
  root.dataset.view = "source";
  const inner = el("div", "inner");
  const deck = el("div", "deck");

  const inputBody = document.createElement("div");
  inputBody.append(
    sourceRow(t("video_folder"), store.inputPath, "/path/to/videos", (v) => store.setInputPath(v)),
  );
  const outputBody = document.createElement("div");
  outputBody.append(
    sourceRow(t("dataset_folder"), store.outputPath, "/path/to/dataset", (v) => store.setOutputPath(v)),
  );

  deck.append(
    renderPanel({ code: "01a", title: t("input"), tag: "SRC", body: [inputBody], bodyClass: "slim" }),
    renderPanel({ code: "01b", title: t("output"), tag: "DST", body: [outputBody], bodyClass: "slim" }),
  );
  inner.append(deck);
  root.append(inner);
  return root;
}
